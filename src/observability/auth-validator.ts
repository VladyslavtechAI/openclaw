/**
 * Auth profile and environment validator.
 * Based on Mar 17 (broken auth-profiles.json parse error) and Mar 23
 * (Trinity wrong suffix format) incidents.
 */

import fs from "node:fs";
import path from "node:path";

export type AuthValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type AuthFileSet = {
  /** Path to openclaw.json. */
  openclawJsonPath?: string;
  /** Path to auth-profiles.json. */
  authProfilesPath?: string;
  /** Path to agent/auth-profiles.json (most critical). */
  agentAuthProfilesPath?: string;
};

export type EnvValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/** Known bad suffix patterns. */
const BAD_SUFFIX_PATTERNS = [
  /^[a-z]+:[a-z]+$/i, // "anthropic:main" pattern
];

/** Common macOS homebrew paths that should be in PATH. */
const MACOS_HOMEBREW_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

/** Critical binaries that should be accessible. */
const CRITICAL_BINARIES = [
  "node",
  "openclaw",
];

/**
 * Validates auth profiles, config files, and environment settings.
 */
export class AuthValidator {
  /**
   * Validate an auth-profiles.json file from disk.
   */
  validateAuthProfilesFile(filePath: string): AuthValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!fs.existsSync(filePath)) {
      return { valid: false, errors: [`File not found: ${filePath}`], warnings: [] };
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      return {
        valid: false,
        errors: [`Cannot read file: ${err instanceof Error ? err.message : "Unknown error"}`],
        warnings: [],
      };
    }

    return this.validateAuthProfilesContent(content);
  }

  /**
   * Validate auth-profiles.json content (string).
   */
  validateAuthProfilesContent(content: string): AuthValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return {
        valid: false,
        errors: [`JSON parse error: ${err instanceof Error ? err.message : "Invalid JSON"}`],
        warnings: [],
      };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { valid: false, errors: ["Auth profiles must be a JSON object"], warnings: [] };
    }

    // Must have profiles object
    const profiles = parsed.profiles;
    if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
      errors.push("Must have a 'profiles' object");
      return { valid: errors.length === 0, errors, warnings };
    }

    for (const [name, profile] of Object.entries(profiles as Record<string, unknown>)) {
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        errors.push(`Profile "${name}" must be an object`);
        continue;
      }

      const p = profile as Record<string, unknown>;

      // Must have type
      if (!p.type || typeof p.type !== "string") {
        errors.push(`Profile "${name}": missing required 'type' string`);
      } else {
        // Check for bad suffix patterns
        for (const pattern of BAD_SUFFIX_PATTERNS) {
          if (pattern.test(p.type)) {
            warnings.push(
              `Profile "${name}": type "${p.type}" looks like a wrong suffix format — should be just "${p.type.split(":")[0]}"`,
            );
          }
        }
      }

      // Must have token
      if (!p.token || typeof p.token !== "string") {
        errors.push(`Profile "${name}": missing required 'token' string`);
      }

      // Token should not be empty
      if (typeof p.token === "string" && p.token.trim() === "") {
        errors.push(`Profile "${name}": token is empty`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate the 3-file set for an agent. File 3 (agent/auth-profiles.json) is most critical.
   */
  validateFileSet(fileSet: AuthFileSet): AuthValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate each file that exists
    if (fileSet.openclawJsonPath) {
      const result = this.validateJsonFile(fileSet.openclawJsonPath);
      if (!result.valid) {
        errors.push(`openclaw.json: ${result.errors.join("; ")}`);
      }
    } else {
      warnings.push("openclaw.json path not provided");
    }

    if (fileSet.authProfilesPath) {
      const result = this.validateAuthProfilesFile(fileSet.authProfilesPath);
      if (!result.valid) {
        errors.push(`auth-profiles.json: ${result.errors.join("; ")}`);
      }
      warnings.push(...result.warnings.map((w) => `auth-profiles.json: ${w}`));
    }

    // File 3 is most critical
    if (fileSet.agentAuthProfilesPath) {
      const result = this.validateAuthProfilesFile(fileSet.agentAuthProfilesPath);
      if (!result.valid) {
        errors.push(`agent/auth-profiles.json (CRITICAL): ${result.errors.join("; ")}`);
      }
      warnings.push(...result.warnings.map((w) => `agent/auth-profiles.json: ${w}`));
    } else {
      errors.push("agent/auth-profiles.json path not provided (most critical file)");
    }

    // Cross-file consistency: check that providers in openclaw.json have matching auth profiles
    if (fileSet.openclawJsonPath && fileSet.authProfilesPath) {
      const consistency = this.checkProviderConsistency(
        fileSet.openclawJsonPath,
        fileSet.authProfilesPath,
      );
      warnings.push(...consistency.warnings);
      errors.push(...consistency.errors);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate that openclaw.json has env.PATH set and critical binaries are accessible.
   */
  validateEnvironment(openclawJsonPath?: string): EnvValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (openclawJsonPath) {
      try {
        const content = fs.readFileSync(openclawJsonPath, "utf-8");
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const env = parsed.env as Record<string, unknown> | undefined;

        if (!env || typeof env !== "object") {
          errors.push("openclaw.json: missing 'env' object");
        } else if (!env.PATH || typeof env.PATH !== "string") {
          errors.push("openclaw.json: env.PATH is not set — cron sub-agents cannot find binaries");
        } else {
          // Check for homebrew paths on macOS
          const pathStr = env.PATH as string;
          for (const hbPath of MACOS_HOMEBREW_PATHS) {
            if (!pathStr.includes(hbPath)) {
              warnings.push(`env.PATH missing homebrew path: ${hbPath}`);
            }
          }
        }
      } catch {
        errors.push(`Cannot read or parse openclaw.json at ${openclawJsonPath}`);
      }
    }

    // Check critical binaries in current PATH
    const currentPath = process.env.PATH ?? "";
    const pathDirs = currentPath.split(path.delimiter);

    for (const binary of CRITICAL_BINARIES) {
      const found = pathDirs.some((dir) => {
        try {
          return fs.existsSync(path.join(dir, binary));
        } catch {
          return false;
        }
      });
      if (!found) {
        warnings.push(`Binary "${binary}" not found in current PATH`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate that a file is valid JSON.
   */
  validateJsonFile(filePath: string): AuthValidationResult {
    if (!fs.existsSync(filePath)) {
      return { valid: false, errors: [`File not found: ${filePath}`], warnings: [] };
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      JSON.parse(content);
      return { valid: true, errors: [], warnings: [] };
    } catch (err) {
      return {
        valid: false,
        errors: [`JSON parse error in ${filePath}: ${err instanceof Error ? err.message : "Invalid JSON"}`],
        warnings: [],
      };
    }
  }

  private checkProviderConsistency(
    openclawJsonPath: string,
    authProfilesPath: string,
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const configContent = fs.readFileSync(openclawJsonPath, "utf-8");
      const config = JSON.parse(configContent) as Record<string, unknown>;

      const authContent = fs.readFileSync(authProfilesPath, "utf-8");
      const auth = JSON.parse(authContent) as Record<string, unknown>;

      const configProviders = new Set<string>();
      if (config.providers && typeof config.providers === "object") {
        for (const key of Object.keys(config.providers as Record<string, unknown>)) {
          configProviders.add(key);
        }
      }

      const authProviders = new Set<string>();
      if (auth.profiles && typeof auth.profiles === "object") {
        for (const profile of Object.values(auth.profiles as Record<string, unknown>)) {
          if (profile && typeof profile === "object") {
            const type = (profile as Record<string, unknown>).type;
            if (typeof type === "string") authProviders.add(type);
          }
        }
      }

      for (const provider of configProviders) {
        if (!authProviders.has(provider)) {
          warnings.push(`Provider "${provider}" in openclaw.json but no matching auth profile`);
        }
      }
    } catch {
      // If files can't be read, skip consistency check (individual file validation already caught it)
    }

    return { errors, warnings };
  }
}
