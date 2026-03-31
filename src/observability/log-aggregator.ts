/**
 * Log aggregator that unifies logs from multiple machines and sources
 * into a single queryable view with structured parsing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogEntry = {
  timestamp: string;
  machine: string;
  source: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
};

export type StoredLogEntry = LogEntry & {
  id: string;
};

export type LogFilter = {
  machine?: string;
  source?: string;
  level?: LogLevel;
  levels?: LogLevel[];
  since?: string;
  until?: string;
  messagePattern?: string;
  limit?: number;
};

export type ErrorSummary = {
  totalErrors: number;
  totalWarnings: number;
  byMachine: Record<string, { errors: number; warnings: number }>;
  bySource: Record<string, { errors: number; warnings: number }>;
  topMessages: Array<{ message: string; count: number; level: LogLevel }>;
  period: { start: string; end: string };
};

export type LogAggregatorConfig = {
  /** Directory for aggregated log files. */
  logDir: string;
  /** Days to retain log files (default: 30). */
  retentionDays?: number;
};

/** Level ordering for comparison. */
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/**
 * Aggregates logs from all machines into a unified, queryable store.
 */
export class LogAggregator {
  private logDir: string;
  private retentionDays: number;
  /** In-memory buffer (bounded at 10000 entries). */
  private buffer: StoredLogEntry[] = [];

  constructor(config: LogAggregatorConfig) {
    this.logDir = config.logDir;
    this.retentionDays = config.retentionDays ?? 30;
    try {
      fs.mkdirSync(config.logDir, { recursive: true });
    } catch {
      // Never crash on directory creation failure
    }
    this.cleanOldFiles();
  }

  /**
   * Ingest an array of log entries.
   */
  ingest(entries: LogEntry[]): StoredLogEntry[] {
    const stored: StoredLogEntry[] = [];
    for (const entry of entries) {
      const record = this.storeEntry(entry);
      stored.push(record);
    }
    return stored;
  }

  /**
   * Ingest a single log entry.
   */
  ingestOne(entry: LogEntry): StoredLogEntry {
    return this.storeEntry(entry);
  }

  /**
   * Parse raw gateway log text into structured entries.
   * Handles lines like: `2025-03-31T10:15:00.000Z [ERROR] gateway: message here`
   * and: `[2025-03-31 10:15:00] ERROR: message here`
   */
  parseGatewayLog(raw: string, machine: string): LogEntry[] {
    if (!raw || typeof raw !== "string") return [];
    const entries: LogEntry[] = [];
    const lines = raw.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const entry = this.parseGatewayLine(line, machine);
        if (entry) entries.push(entry);
      } catch {
        // Skip unparseable lines
      }
    }

    return entries;
  }

  /**
   * Parse launchctl output into structured entries.
   * Handles plist/launchd status lines and exit code messages.
   */
  parseLaunchctlOutput(raw: string, machine: string): LogEntry[] {
    if (!raw || typeof raw !== "string") return [];
    const entries: LogEntry[] = [];
    const lines = raw.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const entry = this.parseLaunchctlLine(line, machine);
        if (entry) entries.push(entry);
      } catch {
        // Skip unparseable lines
      }
    }

    return entries;
  }

  /**
   * Parse PM2 log output into structured entries.
   * Handles lines like: `2025-03-31T10:00:00: 0|app  | message`
   */
  parsePM2Log(raw: string, machine: string): LogEntry[] {
    if (!raw || typeof raw !== "string") return [];
    const entries: LogEntry[] = [];
    const lines = raw.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const entry = this.parsePM2Line(line, machine);
        if (entry) entries.push(entry);
      } catch {
        // Skip unparseable lines
      }
    }

    return entries;
  }

  /**
   * Query logs with filters.
   */
  query(filter: LogFilter = {}): StoredLogEntry[] {
    // Try in-memory buffer first for recent queries
    let results = this.queryBuffer(filter);

    // If buffer doesn't have enough, read from disk
    if (results.length === 0 && (filter.since || filter.until)) {
      results = this.queryDisk(filter);
    }

    if (filter.limit && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Get error summary for the last N hours.
   */
  getErrorSummary(hours: number): ErrorSummary {
    const now = new Date();
    const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
    const until = now.toISOString();

    const entries = this.query({ levels: ["warn", "error", "fatal"], since, until });

    const byMachine: Record<string, { errors: number; warnings: number }> = {};
    const bySource: Record<string, { errors: number; warnings: number }> = {};
    const messageCounts: Map<string, { count: number; level: LogLevel }> = new Map();

    let totalErrors = 0;
    let totalWarnings = 0;

    for (const entry of entries) {
      const isError = entry.level === "error" || entry.level === "fatal";
      const isWarning = entry.level === "warn";

      if (isError) totalErrors++;
      if (isWarning) totalWarnings++;

      // By machine
      if (!byMachine[entry.machine]) byMachine[entry.machine] = { errors: 0, warnings: 0 };
      if (isError) byMachine[entry.machine].errors++;
      if (isWarning) byMachine[entry.machine].warnings++;

      // By source
      if (!bySource[entry.source]) bySource[entry.source] = { errors: 0, warnings: 0 };
      if (isError) bySource[entry.source].errors++;
      if (isWarning) bySource[entry.source].warnings++;

      // Message frequency (truncate to first 100 chars for grouping)
      const msgKey = entry.message.slice(0, 100);
      const existing = messageCounts.get(msgKey);
      if (existing) {
        existing.count++;
      } else {
        messageCounts.set(msgKey, { count: 1, level: entry.level });
      }
    }

    const topMessages = [...messageCounts.entries()]
      .map(([message, { count, level }]) => ({ message, count, level }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalErrors,
      totalWarnings,
      byMachine,
      bySource,
      topMessages,
      period: { start: since, end: until },
    };
  }

  /**
   * Get buffer size (for monitoring).
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  private storeEntry(entry: LogEntry): StoredLogEntry {
    const stored: StoredLogEntry = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: entry.timestamp,
      machine: entry.machine,
      source: entry.source,
      level: entry.level,
      message: entry.message,
      ...(entry.metadata !== undefined && { metadata: entry.metadata }),
    };

    // Add to buffer
    this.buffer.push(stored);
    if (this.buffer.length > 10_000) {
      this.buffer.splice(0, this.buffer.length - 10_000);
    }

    // Persist to disk
    this.persist(stored);

    return stored;
  }

  private persist(entry: StoredLogEntry): void {
    try {
      const filePath = this.getLogFilePath(new Date(entry.timestamp));
      fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
    } catch {
      // Never crash on log write failure
    }
  }

  private parseGatewayLine(line: string, machine: string): LogEntry | null {
    // Format 1: ISO timestamp with bracketed level
    // 2025-03-31T10:15:00.000Z [ERROR] gateway: message
    const fmt1 = line.match(
      /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+\[(\w+)]\s*(\w*):\s*(.*)/,
    );
    if (fmt1) {
      return {
        timestamp: normalizeTimestamp(fmt1[1]),
        machine,
        source: "gateway",
        level: normalizeLevel(fmt1[2]),
        message: fmt1[4].trim(),
        ...(fmt1[3] && { metadata: { component: fmt1[3] } }),
      };
    }

    // Format 2: Bracketed timestamp with level
    // [2025-03-31 10:15:00] ERROR: message
    const fmt2 = line.match(
      /^\[(\d{4}-\d{2}-\d{2}\s+[\d:]+)]\s*(\w+):\s*(.*)/,
    );
    if (fmt2) {
      return {
        timestamp: normalizeTimestamp(fmt2[1]),
        machine,
        source: "gateway",
        level: normalizeLevel(fmt2[2]),
        message: fmt2[3].trim(),
      };
    }

    // Format 3: Just a timestamp and message
    const fmt3 = line.match(
      /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)/,
    );
    if (fmt3) {
      const message = fmt3[2].trim();
      return {
        timestamp: normalizeTimestamp(fmt3[1]),
        machine,
        source: "gateway",
        level: inferLevel(message),
        message,
      };
    }

    // Unparseable — store as raw info
    return {
      timestamp: new Date().toISOString(),
      machine,
      source: "gateway",
      level: "info",
      message: line.trim(),
    };
  }

  private parseLaunchctlLine(line: string, machine: string): LogEntry | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Exit code pattern: "com.openclaw.gateway: exit code: 127"
    const exitMatch = trimmed.match(/^([\w.]+):\s*exit\s+code:\s*(\d+)/i);
    if (exitMatch) {
      const code = parseInt(exitMatch[2], 10);
      const level: LogLevel = code === 0 ? "info" : code === 127 ? "error" : "warn";
      return {
        timestamp: new Date().toISOString(),
        machine,
        source: "launchagent",
        level,
        message: trimmed,
        metadata: { service: exitMatch[1], exitCode: code },
      };
    }

    // Status pattern: "PID = 1234" or "status = 0"
    const statusMatch = trimmed.match(/(PID|status)\s*=\s*(\d+)/i);
    if (statusMatch) {
      return {
        timestamp: new Date().toISOString(),
        machine,
        source: "launchagent",
        level: "info",
        message: trimmed,
        metadata: { [statusMatch[1].toLowerCase()]: parseInt(statusMatch[2], 10) },
      };
    }

    // Error pattern
    if (/error|fail|crash|abort/i.test(trimmed)) {
      return {
        timestamp: new Date().toISOString(),
        machine,
        source: "launchagent",
        level: "error",
        message: trimmed,
      };
    }

    return {
      timestamp: new Date().toISOString(),
      machine,
      source: "launchagent",
      level: "info",
      message: trimmed,
    };
  }

  private parsePM2Line(line: string, machine: string): LogEntry | null {
    // PM2 format: "2025-03-31T10:00:00: 0|app  | message"
    const pm2Match = line.match(
      /^(\d{4}-\d{2}-\d{2}T[\d:.]+):?\s*\d+\|(\S+)\s*\|\s*(.*)/,
    );
    if (pm2Match) {
      const message = pm2Match[3].trim();
      return {
        timestamp: normalizeTimestamp(pm2Match[1]),
        machine,
        source: "pm2",
        level: inferLevel(message),
        message,
        metadata: { app: pm2Match[2] },
      };
    }

    // Simple PM2 output without the standard format
    if (line.trim()) {
      return {
        timestamp: new Date().toISOString(),
        machine,
        source: "pm2",
        level: inferLevel(line),
        message: line.trim(),
      };
    }

    return null;
  }

  private queryBuffer(filter: LogFilter): StoredLogEntry[] {
    const results: StoredLogEntry[] = [];

    for (const entry of this.buffer) {
      if (this.matchesFilter(entry, filter)) {
        results.push(entry);
      }
    }

    return results;
  }

  private queryDisk(filter: LogFilter): StoredLogEntry[] {
    const dates = this.getDateRange(filter.since, filter.until);
    const results: StoredLogEntry[] = [];

    for (const date of dates) {
      const records = this.readDailyRecords(date);
      for (const record of records) {
        if (this.matchesFilter(record, filter)) {
          results.push(record);
        }
      }
    }

    return results;
  }

  private matchesFilter(entry: StoredLogEntry, filter: LogFilter): boolean {
    if (filter.machine && entry.machine !== filter.machine) return false;
    if (filter.source && entry.source !== filter.source) return false;
    if (filter.level && entry.level !== filter.level) return false;
    if (filter.levels && !filter.levels.includes(entry.level)) return false;
    if (filter.since && entry.timestamp < filter.since) return false;
    if (filter.until && entry.timestamp > filter.until) return false;
    if (filter.messagePattern) {
      try {
        const regex = new RegExp(filter.messagePattern, "i");
        if (!regex.test(entry.message)) return false;
      } catch {
        if (!entry.message.toLowerCase().includes(filter.messagePattern.toLowerCase())) return false;
      }
    }
    return true;
  }

  private readDailyRecords(date: Date): StoredLogEntry[] {
    const filePath = this.getLogFilePath(date);
    if (!fs.existsSync(filePath)) return [];
    try {
      return fs
        .readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StoredLogEntry);
    } catch {
      return [];
    }
  }

  private getLogFilePath(date: Date): string {
    return path.join(this.logDir, `logs-${date.toISOString().slice(0, 10)}.jsonl`);
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

  private cleanOldFiles(): void {
    try {
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.logDir).filter((f) => f.startsWith("logs-") && f.endsWith(".jsonl"));

      for (const file of files) {
        const dateStr = file.replace("logs-", "").replace(".jsonl", "");
        const fileDate = new Date(dateStr);
        if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoff) {
          try {
            fs.unlinkSync(path.join(this.logDir, file));
          } catch {
            // Non-critical cleanup
          }
        }
      }
    } catch {
      // Non-critical cleanup; don't crash
    }
  }
}

/** Normalize a level string to a LogLevel. */
function normalizeLevel(level: string): LogLevel {
  const lower = level.toLowerCase().trim();
  if (lower === "debug" || lower === "trace" || lower === "verbose") return "debug";
  if (lower === "info" || lower === "notice") return "info";
  if (lower === "warn" || lower === "warning") return "warn";
  if (lower === "error" || lower === "err") return "error";
  if (lower === "fatal" || lower === "critical" || lower === "emergency" || lower === "panic") return "fatal";
  return "info";
}

/** Infer level from message content. */
function inferLevel(message: string): LogLevel {
  const lower = message.toLowerCase();
  if (/\bfatal\b|\bpanic\b|\bcritical\b/.test(lower)) return "fatal";
  if (/\berror\b|\bfailed\b|\bfailure\b|\bcrash\b|\bexception\b/.test(lower)) return "error";
  if (/\bwarn\b|\bwarning\b|\bdeprecated\b/.test(lower)) return "warn";
  if (/\bdebug\b|\btrace\b/.test(lower)) return "debug";
  return "info";
}

/** Normalize timestamp to ISO format. */
function normalizeTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // Fall through
  }
  return new Date().toISOString();
}
