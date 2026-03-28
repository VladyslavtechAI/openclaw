// ─── Auth Enhancer Middleware ────────────────────────────────────────────────
// RBAC, API key, and JWT authentication middleware.
// JWT verification uses manual HMAC-SHA256 via node:crypto (no external deps).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthConfig } from "../config/EnterpriseConfig.js";
import { Logger } from "../utils/logger.js";
import type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  MiddlewareMetrics,
} from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface JwtHeader {
  alg: string;
  typ: string;
}

interface JwtPayload {
  sub: string;        // agentId
  roles?: string[];
  iat?: number;
  exp?: number;
  iss?: string;
  [key: string]: unknown;
}

interface DecodedJwt {
  header: JwtHeader;
  payload: JwtPayload;
}

/** Maps route patterns (or "*" for global) to required roles. */
type RoleRequirements = Map<string, readonly string[]>;

interface AuthMetrics extends MiddlewareMetrics {
  apiKeyAuths: number;
  jwtAuths: number;
  rbacDenials: number;
  invalidTokens: number;
  expiredTokens: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendUnauthorized(res: OutgoingResponse, message: string): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("WWW-Authenticate", "Bearer");
  const body = JSON.stringify({ error: message });
  if (res.json) {
    res.json({ error: message });
  } else {
    res.end(body);
  }
}

function sendForbidden(res: OutgoingResponse, message: string): void {
  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  const body = JSON.stringify({ error: message });
  if (res.json) {
    res.json({ error: message });
  } else {
    res.end(body);
  }
}

/**
 * Base64url encode (RFC 7515).
 */
function base64urlEncode(data: Buffer): string {
  return data
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Base64url decode (RFC 7515).
 */
function base64urlDecode(str: string): Buffer {
  // Restore standard base64 characters
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += "==";
  else if (pad === 3) base64 += "=";
  return Buffer.from(base64, "base64");
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class AuthEnhancer {
  private readonly config: AuthConfig;
  private readonly logger: Logger;
  /** Map from API key string to agentId. */
  private readonly apiKeys = new Map<string, string>();
  /** Route-level role requirements. Key "*" = applies to all routes. */
  private readonly roleRequirements: RoleRequirements = new Map();
  /** Cache of agentId -> roles, populated during JWT auth. */
  private readonly agentRoles = new Map<string, readonly string[]>();
  private readonly metrics: AuthMetrics = {
    totalRequests: 0,
    blockedRequests: 0,
    errors: 0,
    avgLatencyMs: 0,
    apiKeyAuths: 0,
    jwtAuths: 0,
    rbacDenials: 0,
    invalidTokens: 0,
    expiredTokens: 0,
  };
  private totalLatencyMs = 0;

  /**
   * @param config    - Auth settings from EnterpriseConfig.
   * @param apiKeys   - Initial map of apiKey -> agentId.
   * @param logger    - Optional Logger instance.
   */
  constructor(
    config: AuthConfig,
    apiKeys?: ReadonlyMap<string, string>,
    logger?: Logger,
  ) {
    this.config = config;
    this.logger = logger ?? new Logger("middleware:auth-enhancer");

    if (apiKeys) {
      for (const [key, agentId] of apiKeys) {
        this.apiKeys.set(key, agentId);
      }
    }

    this.logger.info("Auth enhancer initialized", {
      method: this.config.method,
      apiKeyCount: this.apiKeys.size,
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Express / Fastify compatible middleware function. */
  middleware = (
    req: IncomingRequest,
    res: OutgoingResponse,
    next: NextFunction,
  ): void => {
    const start = performance.now();
    this.metrics.totalRequests++;

    try {
      if (!this.config.enabled) {
        this.recordLatency(start);
        next();
        return;
      }

      let authenticated = false;
      let agentId: string | undefined;
      let roles: readonly string[] = [];

      // ── API Key authentication ──────────────────────────────────────
      if (
        this.config.method === "apiKey" ||
        this.config.method === "both"
      ) {
        const result = this.authenticateApiKey(req);
        if (result.authenticated) {
          authenticated = true;
          agentId = result.agentId;
          roles = result.roles;
        }
      }

      // ── JWT authentication ──────────────────────────────────────────
      if (
        !authenticated &&
        (this.config.method === "jwt" || this.config.method === "both")
      ) {
        const result = this.authenticateJwt(req, res, start);
        if (result === null) {
          // Response already sent (401)
          return;
        }
        if (result.authenticated) {
          authenticated = true;
          agentId = result.agentId;
          roles = result.roles;
        }
      }

      if (!authenticated) {
        this.metrics.blockedRequests++;
        this.recordLatency(start);
        sendUnauthorized(res, "Authentication required");
        return;
      }

      // Populate enterprise extensions on the request
      if (agentId) {
        req.agentId = agentId;
      }

      // ── Role-based access control ──────────────────────────────────
      if (!this.checkRoles(req.url, roles)) {
        this.metrics.blockedRequests++;
        this.metrics.rbacDenials++;
        this.recordLatency(start);
        this.logger.warn("RBAC denial", {
          agentId: agentId ?? "unknown",
          url: req.url,
          agentRoles: [...roles],
        });
        sendForbidden(res, "Insufficient permissions");
        return;
      }

      this.recordLatency(start);
      next();
    } catch (err) {
      this.metrics.errors++;
      this.recordLatency(start);
      this.logger.error("Unexpected error in auth middleware", {
        error: err instanceof Error ? err.message : String(err),
        url: req.url,
      });
      // Do not block the request on internal errors
      next();
    }
  };

  /** Register a new API key mapping. */
  addApiKey(apiKey: string, agentId: string): void {
    this.apiKeys.set(apiKey, agentId);
    this.logger.info("API key added", { agentId });
  }

  /** Remove an API key. */
  removeApiKey(apiKey: string): boolean {
    const existed = this.apiKeys.delete(apiKey);
    if (existed) {
      this.logger.info("API key removed");
    }
    return existed;
  }

  /**
   * Set roles that an agent is assigned.
   * Used for API-key-based auth where roles are not embedded in a token.
   */
  setAgentRoles(agentId: string, roles: readonly string[]): void {
    this.agentRoles.set(agentId, roles);
  }

  /**
   * Set role requirements for a route pattern.
   * Use `"*"` for a global requirement that applies to all routes.
   * The agent must have **at least one** of the listed roles.
   */
  setRoleRequirements(routePattern: string, roles: readonly string[]): void {
    this.roleRequirements.set(routePattern, roles);
    this.logger.info("Role requirements updated", {
      routePattern,
      requiredRoles: [...roles],
    });
  }

  /** Return current metrics snapshot. */
  getMetrics(): Readonly<AuthMetrics> {
    return { ...this.metrics };
  }

  // ─── Private: API Key Auth ────────────────────────────────────────────────

  private authenticateApiKey(
    req: IncomingRequest,
  ): { authenticated: boolean; agentId?: string; roles: readonly string[] } {
    // Check header first, then req.apiKey property
    const headerKey = this.extractApiKeyFromHeader(req);
    const key = headerKey ?? req.apiKey;

    if (!key) {
      return { authenticated: false, roles: [] };
    }

    const agentId = this.apiKeys.get(key);
    if (!agentId) {
      this.metrics.invalidTokens++;
      this.logger.warn("Invalid API key presented", {
        ip: req.ip ?? "unknown",
      });
      return { authenticated: false, roles: [] };
    }

    this.metrics.apiKeyAuths++;
    const roles = this.agentRoles.get(agentId) ?? [];
    return { authenticated: true, agentId, roles };
  }

  private extractApiKeyFromHeader(req: IncomingRequest): string | undefined {
    const header = req.headers["x-api-key"];
    if (Array.isArray(header)) return header[0];
    return header;
  }

  // ─── Private: JWT Auth ────────────────────────────────────────────────────

  private authenticateJwt(
    req: IncomingRequest,
    res: OutgoingResponse,
    start: number,
  ): { authenticated: boolean; agentId?: string; roles: readonly string[] } | null {
    const token = this.extractBearerToken(req);
    if (!token) {
      return { authenticated: false, roles: [] };
    }

    const decoded = this.verifyJwt(token);
    if (!decoded) {
      this.metrics.blockedRequests++;
      this.metrics.invalidTokens++;
      this.recordLatency(start);
      sendUnauthorized(res, "Invalid or malformed JWT");
      return null;
    }

    // Check expiration
    if (decoded.payload.exp !== undefined) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (decoded.payload.exp < nowSec) {
        this.metrics.blockedRequests++;
        this.metrics.expiredTokens++;
        this.recordLatency(start);
        sendUnauthorized(res, "JWT has expired");
        return null;
      }
    }

    this.metrics.jwtAuths++;
    const agentId = decoded.payload.sub;
    const roles: readonly string[] = decoded.payload.roles ?? [];

    // Cache roles for this agent
    if (roles.length > 0) {
      this.agentRoles.set(agentId, roles);
    }

    return { authenticated: true, agentId, roles };
  }

  private extractBearerToken(req: IncomingRequest): string | undefined {
    // Check Authorization header
    let authHeader = req.headers["authorization"];
    if (Array.isArray(authHeader)) authHeader = authHeader[0];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }
    // Fallback to req.jwtToken
    return req.jwtToken;
  }

  /**
   * Manually verify a JWT using HMAC-SHA256.
   * Returns the decoded header + payload if valid, or undefined on failure.
   */
  private verifyJwt(token: string): DecodedJwt | undefined {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return undefined;
    }

    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = base64urlEncode(
      createHmac("sha256", this.config.jwtSecret)
        .update(signingInput)
        .digest(),
    );

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signatureB64, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (sigBuffer.length !== expectedBuffer.length) {
      return undefined;
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      return undefined;
    }

    // Decode header
    let header: JwtHeader;
    try {
      const headerJson = base64urlDecode(headerB64).toString("utf8");
      header = JSON.parse(headerJson) as JwtHeader;
    } catch {
      return undefined;
    }

    if (header.alg !== "HS256") {
      this.logger.warn("Unsupported JWT algorithm", { alg: header.alg });
      return undefined;
    }

    // Decode payload
    let payload: JwtPayload;
    try {
      const payloadJson = base64urlDecode(payloadB64).toString("utf8");
      payload = JSON.parse(payloadJson) as JwtPayload;
    } catch {
      return undefined;
    }

    if (!payload.sub || typeof payload.sub !== "string") {
      return undefined;
    }

    return { header, payload };
  }

  // ─── Private: RBAC ────────────────────────────────────────────────────────

  /**
   * Check if the agent's roles satisfy the requirements for the given URL.
   * If no requirements are configured, access is allowed by default.
   */
  private checkRoles(url: string, agentRoles: readonly string[]): boolean {
    // Check route-specific requirements first
    for (const [pattern, requiredRoles] of this.roleRequirements) {
      if (pattern === "*" || url.startsWith(pattern)) {
        // Agent must have at least one of the required roles
        const hasRole = requiredRoles.some((r) => agentRoles.includes(r));
        if (!hasRole && requiredRoles.length > 0) {
          return false;
        }
      }
    }
    return true;
  }

  // ─── Private: Metrics ─────────────────────────────────────────────────────

  private recordLatency(start: number): void {
    const elapsed = performance.now() - start;
    this.totalLatencyMs += elapsed;
    this.metrics.avgLatencyMs =
      this.metrics.totalRequests > 0
        ? this.totalLatencyMs / this.metrics.totalRequests
        : 0;
  }
}
