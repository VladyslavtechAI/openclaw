/**
 * Corporate SSO Bridge
 * SAML/OIDC token validation interfaces, role mapping from IdP claims to agent hierarchy levels.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type HierarchyLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface SAMLAssertion {
  nameID: string;
  issuer: string;
  audience: string;
  attributes: Record<string, string | string[]>;
  notBefore: number;
  notAfter: number;
  sessionIndex?: string;
}

export interface OIDCToken {
  sub: string; // Subject (user ID)
  iss: string; // Issuer
  aud: string | string[]; // Audience
  exp: number; // Expiration time
  iat: number; // Issued at
  email?: string;
  name?: string;
  groups?: string[];
  roles?: string[];
  [key: string]: unknown;
}

export interface RoleMapping {
  idpRole: string; // Role from IdP (SAML attribute or OIDC claim)
  hierarchyLevel: HierarchyLevel;
  department?: string;
  capabilities?: string[];
}

export interface ValidatedIdentity {
  userId: string;
  email?: string;
  name?: string;
  hierarchyLevel: HierarchyLevel;
  department?: string;
  capabilities: string[];
  groups: string[];
  validUntil: number;
}

export interface SSOBridgeConfig {
  storageDir: string;
  samlCertificate?: string; // IdP certificate for SAML validation
  oidcIssuer?: string; // Expected OIDC issuer
  oidcAudience?: string; // Expected OIDC audience
  roleMappings: RoleMapping[];
  defaultLevel?: HierarchyLevel; // Default level if no role matches
}

export class SSOBridge {
  private readonly storageDir: string;
  private readonly configFile: string;
  private readonly samlCertificate?: string;
  private readonly oidcIssuer?: string;
  private readonly oidcAudience?: string;
  private readonly roleMappings: RoleMapping[];
  private readonly defaultLevel: HierarchyLevel;
  private validatedSessions: Map<string, ValidatedIdentity> = new Map();

  constructor(config: SSOBridgeConfig) {
    this.storageDir = config.storageDir;
    this.configFile = path.join(this.storageDir, "sso-sessions.json");
    this.samlCertificate = config.samlCertificate;
    this.oidcIssuer = config.oidcIssuer;
    this.oidcAudience = config.oidcAudience;
    this.roleMappings = config.roleMappings;
    this.defaultLevel = config.defaultLevel ?? 2; // Worker by default

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.configFile)) {
      const data = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      this.validatedSessions = new Map(Object.entries(data));
    }
  }

  private save(): void {
    const data = Object.fromEntries(this.validatedSessions);
    fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * Validate a SAML assertion (simplified - no actual signature validation).
   * In production, use a proper SAML library for signature verification.
   */
  validateSAML(assertion: SAMLAssertion): ValidatedIdentity {
    const now = Date.now();

    // Time validation
    if (assertion.notBefore > now) {
      throw new Error("SAML assertion not yet valid");
    }

    if (assertion.notAfter < now) {
      throw new Error("SAML assertion expired");
    }

    // Extract roles from attributes
    const roles = this.extractSAMLRoles(assertion.attributes);

    // Map roles to hierarchy
    const identity = this.mapRolesToIdentity(
      assertion.nameID,
      roles,
      assertion.notAfter,
      assertion.attributes,
    );

    // Store session
    const sessionId = crypto.randomUUID();
    this.validatedSessions.set(sessionId, identity);
    this.save();

    return identity;
  }

  /**
   * Validate an OIDC token (simplified - no actual signature validation).
   * In production, verify JWT signature using IdP's public keys.
   */
  validateOIDC(token: OIDCToken): ValidatedIdentity {
    const now = Math.floor(Date.now() / 1000);

    // Issuer validation
    if (this.oidcIssuer && token.iss !== this.oidcIssuer) {
      throw new Error(`Invalid issuer: expected ${this.oidcIssuer}, got ${token.iss}`);
    }

    // Audience validation
    if (this.oidcAudience) {
      const audiences = Array.isArray(token.aud) ? token.aud : [token.aud];
      if (!audiences.includes(this.oidcAudience)) {
        throw new Error(`Invalid audience: expected ${this.oidcAudience}`);
      }
    }

    // Time validation
    if (token.exp < now) {
      throw new Error("OIDC token expired");
    }

    if (token.iat > now + 60) {
      throw new Error("OIDC token issued in the future");
    }

    // Extract roles
    const roles = [
      ...(token.roles ?? []),
      ...(token.groups ?? []),
    ];

    // Map roles to hierarchy
    const identity = this.mapRolesToIdentity(
      token.sub,
      roles,
      token.exp * 1000, // Convert to milliseconds
      {
        email: token.email,
        name: token.name,
      },
    );

    // Store session
    const sessionId = crypto.randomUUID();
    this.validatedSessions.set(sessionId, identity);
    this.save();

    return identity;
  }

  private extractSAMLRoles(attributes: Record<string, string | string[]>): string[] {
    const roles: string[] = [];

    // Common SAML attribute names for roles
    const roleAttributes = ["Role", "Roles", "Groups", "MemberOf", "roles", "groups"];

    for (const attr of roleAttributes) {
      const value = attributes[attr];
      if (value) {
        if (Array.isArray(value)) {
          roles.push(...value);
        } else {
          roles.push(value);
        }
      }
    }

    return roles;
  }

  private mapRolesToIdentity(
    userId: string,
    roles: string[],
    validUntil: number,
    attributes: Record<string, unknown>,
  ): ValidatedIdentity {
    // Find the highest-privilege role mapping
    let bestLevel = this.defaultLevel;
    let department: string | undefined;
    const capabilities: string[] = [];

    for (const role of roles) {
      const mapping = this.roleMappings.find((m) => m.idpRole === role);
      if (mapping) {
        // Lower level number = higher privilege
        if (mapping.hierarchyLevel < bestLevel) {
          bestLevel = mapping.hierarchyLevel;
        }

        if (mapping.department) {
          department = mapping.department;
        }

        if (mapping.capabilities) {
          capabilities.push(...mapping.capabilities);
        }
      }
    }

    return {
      userId,
      email: attributes.email as string | undefined,
      name: attributes.name as string | undefined,
      hierarchyLevel: bestLevel,
      department,
      capabilities: Array.from(new Set(capabilities)), // Deduplicate
      groups: roles,
      validUntil,
    };
  }

  /**
   * Get a validated session by user ID.
   */
  getSession(userId: string): ValidatedIdentity | undefined {
    for (const identity of this.validatedSessions.values()) {
      if (identity.userId === userId) {
        // Check if still valid
        if (identity.validUntil < Date.now()) {
          return undefined;
        }
        return identity;
      }
    }
    return undefined;
  }

  /**
   * Revoke a session.
   */
  revokeSession(userId: string): void {
    for (const [sessionId, identity] of this.validatedSessions.entries()) {
      if (identity.userId === userId) {
        this.validatedSessions.delete(sessionId);
      }
    }
    this.save();
  }

  /**
   * Clean up expired sessions.
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, identity] of this.validatedSessions.entries()) {
      if (identity.validUntil < now) {
        this.validatedSessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.save();
    }

    return cleaned;
  }

  /**
   * Add a role mapping.
   */
  addRoleMapping(mapping: RoleMapping): void {
    this.roleMappings.push(mapping);
  }

  /**
   * Get all role mappings.
   */
  getRoleMappings(): RoleMapping[] {
    return [...this.roleMappings];
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): ValidatedIdentity[] {
    const now = Date.now();
    return Array.from(this.validatedSessions.values()).filter(
      (identity) => identity.validUntil > now,
    );
  }

  /**
   * Create a mock SAML assertion for testing.
   */
  static createMockSAML(
    nameID: string,
    roles: string[],
    ttlMs: number = 3600000,
  ): SAMLAssertion {
    const now = Date.now();
    return {
      nameID,
      issuer: "mock-idp",
      audience: "openclaw",
      attributes: {
        Role: roles,
        email: `${nameID}@example.com`,
        name: nameID,
      },
      notBefore: now,
      notAfter: now + ttlMs,
    };
  }

  /**
   * Create a mock OIDC token for testing.
   */
  static createMockOIDC(
    sub: string,
    roles: string[],
    ttlSeconds: number = 3600,
  ): OIDCToken {
    const now = Math.floor(Date.now() / 1000);
    return {
      sub,
      iss: "mock-issuer",
      aud: "openclaw",
      exp: now + ttlSeconds,
      iat: now,
      email: `${sub}@example.com`,
      name: sub,
      roles,
      groups: roles,
    };
  }
}
