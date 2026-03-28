// ─── Request Validator Middleware ────────────────────────────────────────────
// Validates incoming requests: content-type, body size, required fields.

import { Logger } from "../utils/logger.js";
import type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  MiddlewareMetrics,
} from "./types.js";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface RequestValidatorConfig {
  /** Allowed content-type values (matched case-insensitively). Empty = allow all. */
  allowedContentTypes: readonly string[];
  /** Maximum body size in bytes. 0 = unlimited. */
  maxBodyBytes: number;
  /** Fields that MUST be present on `req` (shallow keys). */
  requiredFields: readonly string[];
  /** Whether to require an agentId on every request. */
  requireAgentId: boolean;
}

const DEFAULT_CONFIG: RequestValidatorConfig = {
  allowedContentTypes: ["application/json"],
  maxBodyBytes: 1_048_576, // 1 MiB
  requiredFields: [],
  requireAgentId: false,
};

// ─── Metrics (internal) ─────────────────────────────────────────────────────

interface InternalMetrics extends MiddlewareMetrics {
  contentTypeRejections: number;
  bodySizeRejections: number;
  missingFieldRejections: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendError(
  res: OutgoingResponse,
  statusCode: number,
  message: string,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  const body = JSON.stringify({ error: message });
  if (res.json) {
    res.json({ error: message });
  } else {
    res.end(body);
  }
}

function estimateBodySize(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (Buffer.isBuffer(body)) return body.length;
  // For parsed JSON objects, approximate via serialization
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

function extractContentType(
  headers: IncomingRequest["headers"],
): string | undefined {
  const raw = headers["content-type"];
  if (Array.isArray(raw)) return raw[0]?.toLowerCase();
  return raw?.toLowerCase();
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class RequestValidator {
  private readonly config: RequestValidatorConfig;
  private readonly logger: Logger;
  private readonly metrics: InternalMetrics = {
    totalRequests: 0,
    blockedRequests: 0,
    errors: 0,
    avgLatencyMs: 0,
    contentTypeRejections: 0,
    bodySizeRejections: 0,
    missingFieldRejections: 0,
  };
  private totalLatencyMs = 0;

  constructor(config?: Partial<RequestValidatorConfig>, logger?: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger ?? new Logger("middleware:request-validator");
  }

  /** Express / Fastify compatible middleware function. */
  middleware = (
    req: IncomingRequest,
    res: OutgoingResponse,
    next: NextFunction,
  ): void => {
    const start = performance.now();
    this.metrics.totalRequests++;

    try {
      // ── Content-Type check ──────────────────────────────────────────
      if (
        this.config.allowedContentTypes.length > 0 &&
        (req.method === "POST" ||
          req.method === "PUT" ||
          req.method === "PATCH")
      ) {
        const ct = extractContentType(req.headers);
        if (!ct) {
          this.reject(res, 415, "Missing Content-Type header", "contentType", start);
          return;
        }
        const baseType = ct.split(";")[0]?.trim() ?? "";
        const allowed = this.config.allowedContentTypes.some(
          (a) => a.toLowerCase() === baseType,
        );
        if (!allowed) {
          this.reject(
            res,
            415,
            `Unsupported Content-Type: ${baseType}`,
            "contentType",
            start,
          );
          return;
        }
      }

      // ── Body size check ─────────────────────────────────────────────
      if (this.config.maxBodyBytes > 0 && req.body !== undefined) {
        const size = estimateBodySize(req.body);
        if (size > this.config.maxBodyBytes) {
          this.reject(
            res,
            413,
            `Body size ${size} exceeds limit of ${this.config.maxBodyBytes} bytes`,
            "bodySize",
            start,
          );
          return;
        }
      }

      // ── Required fields ─────────────────────────────────────────────
      for (const field of this.config.requiredFields) {
        const value = (req as unknown as Record<string, unknown>)[field];
        if (value === undefined || value === null || value === "") {
          this.reject(
            res,
            400,
            `Missing required field: ${field}`,
            "missingField",
            start,
          );
          return;
        }
      }

      // ── Agent ID requirement ────────────────────────────────────────
      if (this.config.requireAgentId && !req.agentId) {
        this.reject(res, 400, "Missing required agentId", "missingField", start);
        return;
      }

      // All checks passed
      this.recordLatency(start);
      next();
    } catch (err) {
      this.metrics.errors++;
      this.recordLatency(start);
      this.logger.error("Unexpected error in request validation", {
        error: err instanceof Error ? err.message : String(err),
        url: req.url,
        method: req.method,
      });
      // Do not block the request on internal errors
      next();
    }
  };

  /** Return current metrics snapshot. */
  getMetrics(): Readonly<InternalMetrics> {
    return { ...this.metrics };
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private reject(
    res: OutgoingResponse,
    statusCode: number,
    message: string,
    category: "contentType" | "bodySize" | "missingField",
    start: number,
  ): void {
    this.metrics.blockedRequests++;
    switch (category) {
      case "contentType":
        this.metrics.contentTypeRejections++;
        break;
      case "bodySize":
        this.metrics.bodySizeRejections++;
        break;
      case "missingField":
        this.metrics.missingFieldRejections++;
        break;
    }
    this.recordLatency(start);
    this.logger.warn("Request rejected", { statusCode, message });
    sendError(res, statusCode, message);
  }

  private recordLatency(start: number): void {
    const elapsed = performance.now() - start;
    this.totalLatencyMs += elapsed;
    this.metrics.avgLatencyMs =
      this.metrics.totalRequests > 0
        ? this.totalLatencyMs / this.metrics.totalRequests
        : 0;
  }
}
