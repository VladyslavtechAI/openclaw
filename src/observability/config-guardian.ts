/**
 * Detects batch configuration changes that could break multiple agents simultaneously.
 * Based on the Mar 25 incident where mass OAuth key rollout broke all agents at once.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ConfigChangeEvent = {
  id: string;
  timestamp: string;
  machine: string;
  agentId?: string;
  filePath: string;
  changeType: "create" | "modify" | "delete";
  /** Validation result if content was checked. */
  validationResult?: ConfigValidationResult;
};

export type ConfigValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type ConfigGuardianAlert = {
  id: string;
  timestamp: string;
  severity: "warning" | "critical";
  rule: string;
  message: string;
  machines: string[];
  changes: ConfigChangeEvent[];
};

export type ConfigGuardianConfig = {
  /** Directory for config guardian log files. */
  logDir: string;
  /** Max machines changed before batch alert (default: 2). */
  batchMachineThreshold?: number;
  /** Max agents changed before batch alert (default: 3). */
  batchAgentThreshold?: number;
  /** Window in ms for batch detection (default: 600_000 = 10 minutes). */
  batchWindowMs?: number;
  /** Callback invoked on alerts. */
  onAlert?: (alert: ConfigGuardianAlert) => void;
};

/** Known auth file patterns per agent. */
const AUTH_FILE_PATTERNS = [
  "openclaw.json",
  "auth-profiles.json",
  "agent/auth-profiles.json",
];

/** Common field typos. */
const KNOWN_TYPOS: Record<string, string> = {
  fallbacks: "fallback",
  fallback: "fallbacks",
  models: "model",
  model: "models",
};

/**
 * Guards against batch configuration changes and validates config content.
 */
export class ConfigGuardian {
  private logDir: string;
  private batchMachineThreshold: number;
  private batchAgentThreshold: number;
  private batchWindowMs: number;
  private onAlert: ((alert: ConfigGuardianAlert) => void) | undefined;

  /** Recent changes for batch detection. */
  private recentChanges: ConfigChangeEvent[] = [];

  constructor(config: ConfigGuardianConfig) {
    this.logDir = config.logDir;
    this.batchMachineThreshold = config.batchMachineThreshold ?? 2;
    this.batchAgentThreshold = config.batchAgentThreshold ?? 3;
    this.batchWindowMs = config.batchWindowMs ?? 600_000;
    this.onAlert = config.onAlert;
    try {
      fs.mkdirSync(config.logDir, { recursive: true });
    } catch {
      // Never crash on directory creation failure
    }
  }

  /**
   * Record a config change event and check for batch patterns.
   */
  recordChange(
    event: Omit<ConfigChangeEvent, "id" | "timestamp" | "validationResult"> & { timestamp?: string },
  ): ConfigChangeEvent {
    const stored: ConfigChangeEvent = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: event.timestamp ?? new Date().toISOString(),
      machine: event.machine,
      filePath: event.filePath,
      changeType: event.changeType,
      ...(event.agentId !== undefined && { agentId: event.agentId }),
    };

    try {
      const logPath = this.getLogFilePath(new Date(stored.timestamp));
      fs.appendFileSync(logPath, JSON.stringify(stored) + "\n");
    } catch {
      // Never crash on log write failure
    }

    this.recentChanges.push(stored);
    this.cleanOldChanges();
    this.checkBatchPatterns(stored);

    return stored;
  }

  /**
   * Validate a JSON config file content before applying.
   */
  validateConfig(content: string, fileName: string): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // JSON parse check
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
      return {
        valid: false,
        errors: ["Config must be a JSON object"],
        warnings: [],
      };
    }

    // Check for common typos
    for (const key of Object.keys(parsed)) {
      if (key in KNOWN_TYPOS) {
        warnings.push(`Possible typo: "${key}" — did you mean "${KNOWN_TYPOS[key]}"?`);
      }
    }

    // Deep typo check in nested objects
    this.checkNestedTypos(parsed, warnings, "");

    // File-specific validation
    if (fileName.includes("auth-profiles")) {
      this.validateAuthProfiles(parsed, errors, warnings);
    } else if (fileName === "openclaw.json") {
      this.validateOpenclawConfig(parsed, errors, warnings);
    }

    // Provider config structure check
    this.validateProviderStructure(parsed, errors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate the 3-file consistency for an agent:
   * openclaw.json providers should match auth-profiles.
   */
  validateThreeFileConsistency(
    openclawJson: Record<string, unknown> | undefined,
    authProfiles: Record<string, unknown> | undefined,
    agentAuthProfiles: Record<string, unknown> | undefined,
  ): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!openclawJson) {
      errors.push("openclaw.json is missing");
    }
    if (!authProfiles) {
      warnings.push("auth-profiles.json is missing");
    }
    if (!agentAuthProfiles) {
      errors.push("agent/auth-profiles.json is missing (most critical file)");
    }

    // Check provider alignment
    if (openclawJson && authProfiles) {
      const configProviders = this.extractProviders(openclawJson);
      const authProfileProviders = this.extractProfileProviders(authProfiles);

      for (const provider of configProviders) {
        if (!authProfileProviders.has(provider)) {
          warnings.push(`Provider "${provider}" in openclaw.json but not in auth-profiles.json`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Check if a file path is an auth-related config file.
   */
  isAuthFile(filePath: string): boolean {
    return AUTH_FILE_PATTERNS.some((p) => filePath.endsWith(p));
  }

  /**
   * Query stored config change events.
   */
  query(filter?: { machine?: string; since?: string; until?: string }): ConfigChangeEvent[] {
    const dates = this.getDateRange(filter?.since, filter?.until);
    const results: ConfigChangeEvent[] = [];

    for (const date of dates) {
      const records = this.readDailyRecords(date);
      for (const record of records) {
        if (filter?.machine && record.machine !== filter.machine) continue;
        if (filter?.since && record.timestamp < filter.since) continue;
        if (filter?.until && record.timestamp > filter.until) continue;
        results.push(record);
      }
    }

    return results;
  }

  private validateAuthProfiles(
    parsed: Record<string, unknown>,
    errors: string[],
    warnings: string[],
  ): void {
    const profiles = parsed.profiles;
    if (!profiles || typeof profiles !== "object") {
      errors.push("auth-profiles.json must have a 'profiles' object");
      return;
    }

    for (const [name, profile] of Object.entries(profiles as Record<string, unknown>)) {
      if (!profile || typeof profile !== "object") {
        errors.push(`Profile "${name}" must be an object`);
        continue;
      }

      const p = profile as Record<string, unknown>;
      if (!p.type || typeof p.type !== "string") {
        errors.push(`Profile "${name}" must have a 'type' string`);
      }
      if (!p.token || typeof p.token !== "string") {
        errors.push(`Profile "${name}" must have a 'token' string`);
      }

      // Detect bad suffix patterns like "anthropic:main"
      if (typeof p.type === "string" && p.type.includes(":")) {
        warnings.push(`Profile "${name}" type "${p.type}" contains colon — should be just the provider name (e.g. "anthropic")`);
      }
    }
  }

  private validateOpenclawConfig(
    parsed: Record<string, unknown>,
    errors: string[],
    _warnings: string[],
  ): void {
    // Required fields check
    if (!parsed.providers && !parsed.provider) {
      errors.push("openclaw.json should have 'providers' configured");
    }
  }

  private validateProviderStructure(
    parsed: Record<string, unknown>,
    errors: string[],
  ): void {
    // Check that cost is not at provider level (should be in models[])
    if ("cost" in parsed && "providers" in parsed) {
      errors.push("'cost' should be inside models[], not at provider level");
    }

    // Check nested providers
    const providers = parsed.providers;
    if (providers && typeof providers === "object" && !Array.isArray(providers)) {
      for (const [name, provider] of Object.entries(providers as Record<string, unknown>)) {
        if (provider && typeof provider === "object" && !Array.isArray(provider)) {
          const p = provider as Record<string, unknown>;
          if ("cost" in p) {
            errors.push(`Provider "${name}": 'cost' should be inside models[], not at provider level`);
          }
        }
      }
    }
  }

  private checkNestedTypos(
    obj: Record<string, unknown>,
    warnings: string[],
    prefix: string,
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (key in KNOWN_TYPOS) {
        warnings.push(`Possible typo at "${fullKey}": "${key}" — did you mean "${KNOWN_TYPOS[key]}"?`);
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        this.checkNestedTypos(value as Record<string, unknown>, warnings, fullKey);
      }
    }
  }

  private checkBatchPatterns(event: ConfigChangeEvent): void {
    const now = new Date(event.timestamp).getTime();
    const cutoff = now - this.batchWindowMs;
    const recent = this.recentChanges.filter((c) => new Date(c.timestamp).getTime() > cutoff);

    // Check: configs changed on multiple machines
    const machines = new Set(recent.map((c) => c.machine));
    if (machines.size > this.batchMachineThreshold) {
      this.fireAlert({
        severity: "critical",
        rule: "batch_machine_change",
        message: `Config changes detected on ${machines.size} machines within ${this.batchWindowMs / 60_000} minutes`,
        machines: [...machines],
        changes: recent,
      });
    }

    // Check: multiple agents' auth-profiles changed
    const authChanges = recent.filter((c) => this.isAuthFile(c.filePath));
    const agents = new Set(authChanges.map((c) => c.agentId).filter(Boolean));
    if (agents.size > this.batchAgentThreshold) {
      this.fireAlert({
        severity: "critical",
        rule: "batch_auth_change",
        message: `Auth profile changes for ${agents.size} agents in same batch`,
        machines: [...machines],
        changes: authChanges,
      });
    }
  }

  private fireAlert(partial: Omit<ConfigGuardianAlert, "id" | "timestamp">): void {
    const alert: ConfigGuardianAlert = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      ...partial,
    };

    try {
      const filePath = path.join(this.logDir, "config-alerts.jsonl");
      fs.appendFileSync(filePath, JSON.stringify(alert) + "\n");
    } catch {
      // Never crash on alert write failure
    }

    try {
      this.onAlert?.(alert);
    } catch {
      // Callback errors must not propagate
    }
  }

  private extractProviders(config: Record<string, unknown>): Set<string> {
    const result = new Set<string>();
    const providers = config.providers;
    if (providers && typeof providers === "object") {
      for (const key of Object.keys(providers as Record<string, unknown>)) {
        result.add(key);
      }
    }
    return result;
  }

  private extractProfileProviders(authProfiles: Record<string, unknown>): Set<string> {
    const result = new Set<string>();
    const profiles = authProfiles.profiles;
    if (profiles && typeof profiles === "object") {
      for (const profile of Object.values(profiles as Record<string, unknown>)) {
        if (profile && typeof profile === "object") {
          const type = (profile as Record<string, unknown>).type;
          if (typeof type === "string") {
            result.add(type);
          }
        }
      }
    }
    return result;
  }

  private cleanOldChanges(): void {
    const cutoff = Date.now() - this.batchWindowMs * 2;
    this.recentChanges = this.recentChanges.filter(
      (c) => new Date(c.timestamp).getTime() > cutoff,
    );
  }

  private readDailyRecords(date: Date): ConfigChangeEvent[] {
    const filePath = this.getLogFilePath(date);
    if (!fs.existsSync(filePath)) return [];
    try {
      return fs
        .readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ConfigChangeEvent);
    } catch {
      return [];
    }
  }

  private getLogFilePath(date: Date): string {
    return path.join(this.logDir, `config-changes-${date.toISOString().slice(0, 10)}.jsonl`);
  }

  private getDateRange(since?: string, until?: string): Date[] {
    const end = until ? new Date(until) : new Date();
    const start = since ? new Date(since) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const dates: Date[] = [];
    const current = new Date(start.toISOString().slice(0, 10));
    let count = 0;
    while (current <= end && count < 90) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
      count++;
    }
    return dates;
  }
}
