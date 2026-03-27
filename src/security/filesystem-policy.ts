/**
 * Filesystem access policy for agent isolation.
 * Restricts which paths each agent can read/write.
 */

import fs from "node:fs";
import path from "node:path";

export type FilesystemPolicyConfig = {
  /** Paths hidden from the agent (default: sensitive files) */
  hiddenPaths?: string[];
  /** Paths the agent is allowed to access (default: workspace only) */
  allowedPaths?: string[];
  /** Block path traversal (../) — default: true */
  blockTraversal?: boolean;
  /** Block symlinks to hidden paths — default: true */
  blockSymlinks?: boolean;
  /** Restrict to workspace only — default: true */
  workspaceOnly?: boolean;
};

const DEFAULT_HIDDEN_PATHS = [
  "openclaw.json",
  "auth-profiles.json",
  "CREDENTIALS_VAULT.md",
  ".ssh",
  ".gnupg",
  ".env",
  ".netrc",
  ".aws/credentials",
  ".config/gh/hosts.yml",
];

export type PathCheckResult = {
  allowed: boolean;
  reason?: string;
};

/**
 * Filesystem policy enforcer.
 */
export class FilesystemPolicy {
  private hiddenPaths: string[];
  private allowedPaths: string[];
  private blockTraversal: boolean;
  private blockSymlinks: boolean;

  constructor(config: FilesystemPolicyConfig = {}) {
    this.hiddenPaths = config.hiddenPaths ?? DEFAULT_HIDDEN_PATHS;
    this.allowedPaths = config.allowedPaths ?? [];
    this.blockTraversal = config.blockTraversal ?? true;
    this.blockSymlinks = config.blockSymlinks ?? true;
  }

  /**
   * Check if a path is accessible by the agent.
   */
  checkAccess(requestedPath: string, workspaceDir?: string): PathCheckResult {
    const normalized = path.normalize(requestedPath);

    // 1. Block null bytes (classic attack)
    if (requestedPath.includes("\0")) {
      return { allowed: false, reason: "Blocked: null byte in path" };
    }

    // 2. Block path traversal
    if (this.blockTraversal) {
      if (requestedPath.includes("..")) {
        // Check if resolved path escapes workspace
        if (workspaceDir) {
          const resolved = path.resolve(workspaceDir, requestedPath);
          if (!resolved.startsWith(path.resolve(workspaceDir))) {
            return { allowed: false, reason: "Blocked: path traversal escapes workspace" };
          }
        } else {
          return { allowed: false, reason: "Blocked: path traversal (no workspace context)" };
        }
      }
    }

    // 3. Check hidden paths
    for (const hidden of this.hiddenPaths) {
      const hiddenLower = hidden.toLowerCase();
      const normalizedLower = normalized.toLowerCase();
      const basename = path.basename(normalized).toLowerCase();

      if (
        normalizedLower.includes(hiddenLower) ||
        basename === hiddenLower ||
        normalizedLower.endsWith(`/${hiddenLower}`)
      ) {
        return { allowed: false, reason: `Blocked: hidden path (${hidden})` };
      }
    }

    // 4. Check symlinks
    if (this.blockSymlinks) {
      try {
        const stats = fs.lstatSync(normalized);
        if (stats.isSymbolicLink()) {
          const realPath = fs.realpathSync(normalized);
          // Check if symlink target is hidden
          const targetCheck = this.checkAccess(realPath, workspaceDir);
          if (!targetCheck.allowed) {
            return { allowed: false, reason: `Blocked: symlink to restricted path` };
          }
        }
      } catch {
        // File doesn't exist yet (write operation) — allow if passes other checks
      }
    }

    // 5. Check allowed paths (if configured)
    if (this.allowedPaths.length > 0) {
      const resolvedPath = path.resolve(normalized);
      const isAllowed = this.allowedPaths.some((ap) =>
        resolvedPath.startsWith(path.resolve(ap)),
      );
      if (!isAllowed) {
        return { allowed: false, reason: `Blocked: not in allowed paths` };
      }
    }

    return { allowed: true };
  }

  /**
   * Get the default hidden paths list.
   */
  static getDefaultHiddenPaths(): string[] {
    return [...DEFAULT_HIDDEN_PATHS];
  }
}
