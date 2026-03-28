// ─── Rate Limiter Middleware ─────────────────────────────────────────────────
// Per-agent sliding window rate limiting with in-memory tracking.

import type { RateLimiterConfig } from "../config/EnterpriseConfig.js";
import { Logger } from "../utils/logger.js";
import type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  MiddlewareMetrics,
} from "./types.js";

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Timestamps of requests within the current window. */
interface SlidingWindow {
  timestamps: number[];
  /** Last time this entry was accessed (for stale cleanup). */
  lastAccess: number;
}

interface RateLimiterMetrics extends MiddlewareMetrics {
  /** Number of currently tracked clients. */
  trackedClients: number;
  /** Total 429 responses sent. */
  rateLimitHits: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendTooManyRequests(
  res: OutgoingResponse,
  retryAfterMs: number,
): void {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  res.statusCode = 429;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Retry-After", String(retryAfterSec));
  const body = JSON.stringify({
    error: "Too many requests",
    retryAfterMs,
  });
  if (res.json) {
    res.json({ error: "Too many requests", retryAfterMs });
  } else {
    res.end(body);
  }
}

function clientKey(req: IncomingRequest): string {
  return req.agentId ?? req.ip ?? "unknown";
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly windows = new Map<string, SlidingWindow>();
  private readonly logger: Logger;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private readonly metrics: RateLimiterMetrics = {
    totalRequests: 0,
    blockedRequests: 0,
    errors: 0,
    avgLatencyMs: 0,
    trackedClients: 0,
    rateLimitHits: 0,
  };
  private totalLatencyMs = 0;

  /**
   * @param config - Rate limiter settings from EnterpriseConfig.
   * @param logger - Optional Logger instance; a default will be created.
   * @param cleanupIntervalMs - How often to purge stale entries (default: 60 s).
   */
  constructor(
    config: RateLimiterConfig,
    logger?: Logger,
    cleanupIntervalMs = 60_000,
  ) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;
    this.logger = logger ?? new Logger("middleware:rate-limiter");

    // Periodic cleanup so the Map does not grow without bound.
    this.cleanupTimer = setInterval(() => {
      this.purgeStaleEntries();
    }, cleanupIntervalMs);

    // Allow the Node process to exit even if the timer is pending.
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }

    this.logger.info("Rate limiter initialized", {
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
      cleanupIntervalMs,
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
      const key = clientKey(req);
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Get or create window
      let window = this.windows.get(key);
      if (!window) {
        window = { timestamps: [], lastAccess: now };
        this.windows.set(key, window);
      }

      // Slide: remove timestamps older than the window
      window.timestamps = window.timestamps.filter((t) => t > windowStart);
      window.lastAccess = now;

      if (window.timestamps.length >= this.maxRequests) {
        // Exceeded limit
        this.metrics.blockedRequests++;
        this.metrics.rateLimitHits++;
        this.metrics.trackedClients = this.windows.size;
        this.recordLatency(start);

        // Compute how long until the oldest entry in the window expires
        const oldestInWindow = window.timestamps[0] ?? now;
        const retryAfterMs = Math.max(0, oldestInWindow + this.windowMs - now);

        this.logger.warn("Rate limit exceeded", {
          key,
          currentCount: window.timestamps.length,
          maxRequests: this.maxRequests,
          retryAfterMs,
        });

        sendTooManyRequests(res, retryAfterMs);
        return;
      }

      // Record this request
      window.timestamps.push(now);
      this.metrics.trackedClients = this.windows.size;
      this.recordLatency(start);

      // Expose remaining quota in headers
      const remaining = this.maxRequests - window.timestamps.length;
      res.setHeader("X-RateLimit-Limit", String(this.maxRequests));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader(
        "X-RateLimit-Reset",
        String(Math.ceil((windowStart + this.windowMs) / 1000)),
      );

      next();
    } catch (err) {
      this.metrics.errors++;
      this.recordLatency(start);
      this.logger.error("Unexpected error in rate limiter", {
        error: err instanceof Error ? err.message : String(err),
        url: req.url,
      });
      // Do not block the request on internal errors
      next();
    }
  };

  /** Return current metrics snapshot. */
  getMetrics(): Readonly<RateLimiterMetrics> {
    return { ...this.metrics, trackedClients: this.windows.size };
  }

  /** Manually reset limits for a specific client key. */
  resetClient(key: string): boolean {
    return this.windows.delete(key);
  }

  /** Tear down the cleanup timer. Call when shutting down the server. */
  destroy(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.windows.clear();
    this.logger.info("Rate limiter destroyed");
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /** Remove entries that have not been accessed within 2x the window period. */
  private purgeStaleEntries(): void {
    const cutoff = Date.now() - this.windowMs * 2;
    let purged = 0;
    for (const [key, window] of this.windows) {
      if (window.lastAccess < cutoff) {
        this.windows.delete(key);
        purged++;
      }
    }
    if (purged > 0) {
      this.logger.debug("Purged stale rate-limit entries", {
        purged,
        remaining: this.windows.size,
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
