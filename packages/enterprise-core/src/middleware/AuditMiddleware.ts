// ─── Audit Middleware ────────────────────────────────────────────────────────
// Records every request with timing, identity, and status information.
// Maintains an in-memory circular buffer that can be queried at runtime.

import { Logger } from "../utils/logger.js";
import type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  MiddlewareMetrics,
} from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  method: string;
  url: string;
  agentId: string | undefined;
  ip: string | undefined;
  statusCode: number;
  responseTimeMs: number;
}

export interface AuditMiddlewareConfig {
  /** Maximum number of entries to keep in the in-memory buffer. */
  maxBufferSize: number;
  /** Whether to log every request via the Logger (can be noisy). */
  logRequests: boolean;
}

interface AuditMetrics extends MiddlewareMetrics {
  /** Number of entries currently in the buffer. */
  bufferedEntries: number;
  /** Total entries ever recorded (may exceed buffer size). */
  totalEntriesRecorded: number;
}

const DEFAULT_CONFIG: AuditMiddlewareConfig = {
  maxBufferSize: 10_000,
  logRequests: true,
};

// ─── Class ──────────────────────────────────────────────────────────────────

export class AuditMiddleware {
  private readonly config: AuditMiddlewareConfig;
  private readonly logger: Logger;
  private readonly buffer: AuditEntry[] = [];
  private readonly metrics: AuditMetrics = {
    totalRequests: 0,
    blockedRequests: 0, // audit never blocks
    errors: 0,
    avgLatencyMs: 0,
    bufferedEntries: 0,
    totalEntriesRecorded: 0,
  };
  private totalLatencyMs = 0;

  constructor(config?: Partial<AuditMiddlewareConfig>, logger?: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger ?? new Logger("middleware:audit");
    this.logger.info("Audit middleware initialized", {
      maxBufferSize: this.config.maxBufferSize,
      logRequests: this.config.logRequests,
    });
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
      // Capture the original `end` so we can intercept the response completion.
      const originalEnd = res.end.bind(res) as (body?: string) => void;
      const self = this;

      res.end = function auditEnd(body?: string): void {
        // Calculate response time BEFORE calling original end
        const responseTimeMs = performance.now() - start;

        const entry: AuditEntry = {
          timestamp: new Date().toISOString(),
          method: req.method,
          url: req.url,
          agentId: req.agentId,
          ip: req.ip,
          statusCode: res.statusCode,
          responseTimeMs: Math.round(responseTimeMs * 100) / 100,
        };

        self.recordEntry(entry, responseTimeMs);
        originalEnd(body);
      };

      // Also intercept json() if available
      if (res.json) {
        const originalJson = res.json.bind(res) as (data: unknown) => void;
        res.json = function auditJson(data: unknown): void {
          const responseTimeMs = performance.now() - start;

          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.url,
            agentId: req.agentId,
            ip: req.ip,
            statusCode: res.statusCode,
            responseTimeMs: Math.round(responseTimeMs * 100) / 100,
          };

          self.recordEntry(entry, responseTimeMs);
          originalJson(data);
        };
      }

      next();
    } catch (err) {
      this.metrics.errors++;
      this.recordLatency(start);
      this.logger.error("Unexpected error in audit middleware", {
        error: err instanceof Error ? err.message : String(err),
        url: req.url,
        method: req.method,
      });
      // Never block the request
      next();
    }
  };

  /**
   * Retrieve the most recent audit entries.
   * @param count - Number of entries to return (default: 100). Capped at buffer size.
   */
  getRecentEntries(count = 100): readonly AuditEntry[] {
    const n = Math.min(count, this.buffer.length);
    // Return newest first
    return this.buffer.slice(-n).reverse();
  }

  /**
   * Query entries matching a filter predicate.
   * @param predicate - Filter function.
   * @param limit - Maximum results (default: 100).
   */
  queryEntries(
    predicate: (entry: AuditEntry) => boolean,
    limit = 100,
  ): readonly AuditEntry[] {
    const results: AuditEntry[] = [];
    // Iterate from newest to oldest
    for (let i = this.buffer.length - 1; i >= 0 && results.length < limit; i--) {
      const entry = this.buffer[i];
      if (entry !== undefined && predicate(entry)) {
        results.push(entry);
      }
    }
    return results;
  }

  /** Return current metrics snapshot. */
  getMetrics(): Readonly<AuditMetrics> {
    return {
      ...this.metrics,
      bufferedEntries: this.buffer.length,
    };
  }

  /** Clear all buffered entries. */
  clearBuffer(): void {
    this.buffer.length = 0;
    this.logger.info("Audit buffer cleared");
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private recordEntry(entry: AuditEntry, responseTimeMs: number): void {
    // Circular buffer: evict oldest if at capacity
    if (this.buffer.length >= this.config.maxBufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(entry);

    this.metrics.totalEntriesRecorded++;
    this.recordLatency(performance.now() - responseTimeMs);

    if (this.config.logRequests) {
      this.logger.info("Request completed", {
        method: entry.method,
        url: entry.url,
        agentId: entry.agentId ?? "anonymous",
        ip: entry.ip ?? "unknown",
        statusCode: entry.statusCode,
        responseTimeMs: entry.responseTimeMs,
      });
    }
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
