/**
 * Tamper-evident audit logging with hash chain and secret scrubbing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type AuditEventType =
  | "tool.exec" | "tool.read" | "tool.write" | "tool.web_fetch"
  | "message.send" | "message.receive"
  | "auth.login" | "auth.failure"
  | "policy.deny" | "policy.warn"
  | "session.create" | "session.destroy"
  | "config.change" | "skill.install"
  | "security.injection_detected" | "security.exfil_blocked" | "security.backdoor_found";

export type AuditEvent = {
  timestamp: number;
  type: AuditEventType;
  agentId: string;
  sessionKey?: string;
  action: string;
  parameters?: Record<string, unknown>;
  result?: "allowed" | "denied" | "error";
  metadata?: Record<string, unknown>;
};

export type AuditRecord = AuditEvent & {
  seq: number;
  hash: string;
  prevHash: string;
};

/** Secret patterns to scrub from audit logs. */
const SECRET_PATTERNS = [
  { pattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED:anthropic_key]" },
  { pattern: /sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED:anthropic_token]" },
  { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED:openai_key]" },
  { pattern: /sk-[A-Za-z0-9]{40,}/g, replacement: "[REDACTED:api_key]" },
  { pattern: /ghp_[A-Za-z0-9]{36}/g, replacement: "[REDACTED:github_token]" },
  { pattern: /AIzaSy[A-Za-z0-9_-]{33}/g, replacement: "[REDACTED:google_key]" },
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: "[REDACTED:aws_key]" },
  { pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/g, replacement: "[REDACTED:private_key]" },
  { pattern: /(password|passwd|secret|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi, replacement: "$1=[REDACTED]" },
];

/**
 * Scrub secrets from a string.
 */
export function scrubSecrets(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }
  return result;
}

/**
 * Tamper-evident audit logger using JSONL + hash chain.
 */
export class AuditLogger {
  private logDir: string;
  private seq: number = 0;
  private prevHash: string = "genesis";
  private scrubEnabled: boolean;

  constructor(config: { logDir: string; scrubSecrets?: boolean }) {
    this.logDir = config.logDir;
    this.scrubEnabled = config.scrubSecrets ?? true;
    fs.mkdirSync(config.logDir, { recursive: true });
    this.loadState();
  }

  /**
   * Log an audit event.
   */
  log(event: AuditEvent): AuditRecord {
    const scrubbed = this.scrubEnabled ? this.scrubEvent(event) : event;

    this.seq++;
    const record: AuditRecord = {
      ...scrubbed,
      seq: this.seq,
      prevHash: this.prevHash,
      hash: "", // Computed below
    };

    record.hash = this.computeHash(record);
    this.prevHash = record.hash;

    this.appendRecord(record);
    return record;
  }

  /**
   * Verify hash chain integrity.
   */
  verifyChain(date?: Date): { valid: boolean; brokenAt?: number; totalRecords: number } {
    const records = this.readRecords(date);
    if (records.length === 0) return { valid: true, totalRecords: 0 };

    let prevHash = records[0].prevHash;
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.prevHash !== prevHash && i > 0) {
        return { valid: false, brokenAt: i, totalRecords: records.length };
      }
      const expectedHash = this.computeHash({ ...record, hash: "" });
      if (record.hash !== expectedHash) {
        return { valid: false, brokenAt: i, totalRecords: records.length };
      }
      prevHash = record.hash;
    }

    return { valid: true, totalRecords: records.length };
  }

  /**
   * Query audit records.
   */
  query(filter: {
    agentId?: string;
    type?: AuditEventType;
    since?: number;
    limit?: number;
    date?: Date;
  }): AuditRecord[] {
    let records = this.readRecords(filter.date);

    if (filter.agentId) {
      records = records.filter((r) => r.agentId === filter.agentId);
    }
    if (filter.type) {
      records = records.filter((r) => r.type === filter.type);
    }
    if (filter.since) {
      records = records.filter((r) => r.timestamp >= filter.since);
    }
    if (filter.limit) {
      records = records.slice(-filter.limit);
    }

    return records;
  }

  /**
   * Get record count for today.
   */
  getRecordCount(date?: Date): number {
    return this.readRecords(date).length;
  }

  private scrubEvent(event: AuditEvent): AuditEvent {
    const scrubbed = { ...event };
    if (scrubbed.parameters) {
      scrubbed.parameters = JSON.parse(scrubSecrets(JSON.stringify(scrubbed.parameters)));
    }
    if (scrubbed.action) {
      scrubbed.action = scrubSecrets(scrubbed.action);
    }
    return scrubbed;
  }

  private computeHash(record: AuditRecord): string {
    const data = `${record.seq}:${record.prevHash}:${record.timestamp}:${record.type}:${record.agentId}:${record.action}`;
    return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
  }

  private appendRecord(record: AuditRecord): void {
    const filePath = this.getLogFilePath();
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
  }

  private readRecords(date?: Date): AuditRecord[] {
    const filePath = this.getLogFilePath(date);
    if (!fs.existsSync(filePath)) return [];
    try {
      return fs.readFileSync(filePath, "utf-8")
        .trim().split("\n").filter(Boolean)
        .map((line) => JSON.parse(line) as AuditRecord);
    } catch { return []; }
  }

  private getLogFilePath(date?: Date): string {
    const d = date ?? new Date();
    return path.join(this.logDir, `audit-${d.toISOString().slice(0, 10)}.jsonl`);
  }

  private loadState(): void {
    const records = this.readRecords();
    if (records.length > 0) {
      const last = records[records.length - 1];
      this.seq = last.seq;
      this.prevHash = last.hash;
    }
  }
}
