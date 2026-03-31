/**
 * Central event logger for observability across gateway and agent infrastructure.
 * Stores events in daily JSONL files with auto-rotation and queryable interface.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EventLevel = "info" | "warn" | "error" | "critical";

export type EventCategory = "gateway" | "agent" | "config" | "api" | "tool" | "intervention";

export type ObservabilityEvent = {
  timestamp: string;
  level: EventLevel;
  category: EventCategory;
  machine: string;
  agentId?: string;
  event: string;
  data?: Record<string, unknown>;
  correlationId?: string;
};

export type StoredEvent = ObservabilityEvent & {
  id: string;
};

export type EventFilter = {
  level?: EventLevel;
  levels?: EventLevel[];
  category?: EventCategory;
  categories?: EventCategory[];
  machine?: string;
  agentId?: string;
  event?: string;
  since?: string;
  until?: string;
  correlationId?: string;
  limit?: number;
};

export type TimeRange = {
  start: string;
  end: string;
};

export type Metrics = {
  totalEvents: number;
  byLevel: Record<EventLevel, number>;
  byCategory: Record<EventCategory, number>;
  byMachine: Record<string, number>;
  errorRate: number;
  topEvents: Array<{ event: string; count: number }>;
};

export type EventLoggerConfig = {
  /** Directory for event log files. */
  logDir: string;
  /** Days to retain log files (default: 30). */
  retentionDays?: number;
  /** Machine name override (default: os.hostname()). */
  machineName?: string;
};

type Subscriber = {
  filter: EventFilter;
  callback: (event: StoredEvent) => void;
};

/**
 * Central event logger with JSONL storage, daily rotation, and query support.
 */
export class EventLogger {
  private logDir: string;
  private retentionDays: number;
  private machineName: string;
  private subscribers: Map<string, Subscriber> = new Map();

  constructor(config: EventLoggerConfig) {
    this.logDir = config.logDir;
    this.retentionDays = config.retentionDays ?? 30;
    this.machineName = config.machineName ?? os.hostname();
    fs.mkdirSync(config.logDir, { recursive: true });
    this.cleanOldFiles();
  }

  /**
   * Log an observability event. Assigns an ID and persists to disk.
   */
  log(event: Omit<ObservabilityEvent, "timestamp" | "machine"> & { timestamp?: string; machine?: string }): StoredEvent {
    const stored: StoredEvent = {
      timestamp: event.timestamp ?? new Date().toISOString(),
      level: event.level,
      category: event.category,
      machine: event.machine ?? this.machineName,
      event: event.event,
      id: this.generateId(),
      ...(event.agentId !== undefined && { agentId: event.agentId }),
      ...(event.data !== undefined && { data: event.data }),
      ...(event.correlationId !== undefined && { correlationId: event.correlationId }),
    };

    try {
      const filePath = this.getLogFilePath(new Date(stored.timestamp));
      fs.appendFileSync(filePath, JSON.stringify(stored) + "\n");
    } catch {
      // Never crash the gateway on log write failure
    }

    // Notify subscribers
    for (const sub of this.subscribers.values()) {
      if (this.matchesFilter(stored, sub.filter)) {
        try {
          sub.callback(stored);
        } catch {
          // Subscriber errors must not propagate
        }
      }
    }

    return stored;
  }

  /**
   * Query stored events with filters.
   */
  query(filter: EventFilter = {}): StoredEvent[] {
    const dates = this.getDateRange(filter.since, filter.until);
    let results: StoredEvent[] = [];

    for (const date of dates) {
      const records = this.readDailyRecords(date);
      for (const record of records) {
        if (this.matchesFilter(record, filter)) {
          results.push(record);
        }
      }
    }

    if (filter.limit && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Subscribe to events matching a filter. Returns an unsubscribe function.
   */
  subscribe(filter: EventFilter, callback: (event: StoredEvent) => void): () => void {
    const id = this.generateId();
    this.subscribers.set(id, { filter, callback });
    return () => {
      this.subscribers.delete(id);
    };
  }

  /**
   * Get aggregated metrics for a time range.
   */
  getMetrics(timeRange: TimeRange): Metrics {
    const events = this.query({ since: timeRange.start, until: timeRange.end });

    const byLevel: Record<EventLevel, number> = { info: 0, warn: 0, error: 0, critical: 0 };
    const byCategory: Record<EventCategory, number> = {
      gateway: 0,
      agent: 0,
      config: 0,
      api: 0,
      tool: 0,
      intervention: 0,
    };
    const byMachine: Record<string, number> = {};
    const eventCounts: Record<string, number> = {};

    for (const event of events) {
      byLevel[event.level]++;
      byCategory[event.category]++;
      byMachine[event.machine] = (byMachine[event.machine] ?? 0) + 1;
      eventCounts[event.event] = (eventCounts[event.event] ?? 0) + 1;
    }

    const topEvents = Object.entries(eventCounts)
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const errorCount = byLevel.error + byLevel.critical;
    const errorRate = events.length > 0 ? errorCount / events.length : 0;

    return {
      totalEvents: events.length,
      byLevel,
      byCategory,
      byMachine,
      errorRate,
      topEvents,
    };
  }

  /**
   * Export events as JSON or CSV.
   */
  exportEvents(format: "json" | "csv", filter?: EventFilter): string {
    const events = this.query(filter ?? {});

    if (format === "json") {
      return JSON.stringify(events, null, 2);
    }

    // CSV export
    const headers = ["id", "timestamp", "level", "category", "machine", "agentId", "event", "correlationId", "data"];
    const rows = events.map((e) =>
      [
        e.id,
        e.timestamp,
        e.level,
        e.category,
        e.machine,
        e.agentId ?? "",
        e.event,
        e.correlationId ?? "",
        e.data ? JSON.stringify(e.data).replace(/"/g, '""') : "",
      ]
        .map((v) => `"${v}"`)
        .join(","),
    );

    return [headers.join(","), ...rows].join("\n");
  }

  /**
   * Get the number of active subscribers.
   */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  private matchesFilter(event: StoredEvent, filter: EventFilter): boolean {
    if (filter.level && event.level !== filter.level) return false;
    if (filter.levels && !filter.levels.includes(event.level)) return false;
    if (filter.category && event.category !== filter.category) return false;
    if (filter.categories && !filter.categories.includes(event.category)) return false;
    if (filter.machine && event.machine !== filter.machine) return false;
    if (filter.agentId && event.agentId !== filter.agentId) return false;
    if (filter.event && event.event !== filter.event) return false;
    if (filter.correlationId && event.correlationId !== filter.correlationId) return false;
    if (filter.since && event.timestamp < filter.since) return false;
    if (filter.until && event.timestamp > filter.until) return false;
    return true;
  }

  private getDateRange(since?: string, until?: string): Date[] {
    const end = until ? new Date(until) : new Date();
    const start = since ? new Date(since) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const dates: Date[] = [];
    const current = new Date(start.toISOString().slice(0, 10));

    // Cap at 90 days to avoid runaway iteration
    const maxDays = 90;
    let count = 0;
    while (current <= end && count < maxDays) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
      count++;
    }

    return dates;
  }

  private readDailyRecords(date: Date): StoredEvent[] {
    const filePath = this.getLogFilePath(date);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      return fs
        .readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StoredEvent);
    } catch {
      return [];
    }
  }

  private getLogFilePath(date?: Date): string {
    const d = date ?? new Date();
    return path.join(this.logDir, `events-${d.toISOString().slice(0, 10)}.jsonl`);
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  private cleanOldFiles(): void {
    try {
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.logDir).filter((f) => f.startsWith("events-") && f.endsWith(".jsonl"));

      for (const file of files) {
        const dateStr = file.replace("events-", "").replace(".jsonl", "");
        const fileDate = new Date(dateStr);
        if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoff) {
          fs.unlinkSync(path.join(this.logDir, file));
        }
      }
    } catch {
      // Non-critical cleanup; don't crash
    }
  }
}
