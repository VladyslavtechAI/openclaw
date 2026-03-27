/**
 * Smart model router with Claude Code integration and rate-limit awareness.
 * Routes requests through free Claude Code instances first, falls back to API.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("smart-router");

export type ClaudeCodeInstance = {
  host: string;
  user: string;
  subscription: string;
  /** Current rate limit status */
  rateLimited: boolean;
  /** When rate limit was detected (epoch ms) */
  rateLimitedAt?: number;
  /** Estimated rate limit reset time (epoch ms) */
  rateLimitResetAt?: number;
};

export type SmartRouterConfig = {
  /** Enable smart routing (default: false) */
  enabled?: boolean;
  /** Claude Code instances for free Opus */
  claudeCode?: {
    instances: ClaudeCodeInstance[];
    /** What to do on rate limit: queue, api, notify */
    onRateLimit: "queue" | "api" | "notify";
    /** Retry interval for queued tasks (minutes) */
    queueRetryMinutes?: number;
  };
  /** Queue directory for pending tasks */
  queueDir?: string;
};

export type RouteResult = {
  /** Where the request was routed */
  source: "claude-code" | "api" | "queued" | "failed";
  /** Claude Code instance used (if applicable) */
  instance?: ClaudeCodeInstance;
  /** Cost of the request ($0 for Claude Code) */
  estimatedCost: number;
  /** If queued, the task ID */
  taskId?: string;
  /** Human-readable message */
  message: string;
};

export type QueuedTask = {
  id: string;
  task: string;
  workdir: string;
  files?: string[];
  agentId: string;
  createdAt: number;
  status: "pending" | "processing" | "done" | "failed";
  result?: string;
  error?: string;
};

/**
 * Rate limit window estimation.
 * Based on production data: ~200-300 Opus msgs/day per Max subscription.
 * Sliding window ~5h, full reset 24h.
 */
const RATE_LIMIT_RESET_MS = 5 * 60 * 60 * 1000; // 5 hours

/**
 * Smart router that prioritizes free Claude Code over paid API.
 */
export class SmartRouter {
  private config: SmartRouterConfig;
  private instances: ClaudeCodeInstance[];

  constructor(config: SmartRouterConfig) {
    this.config = config;
    this.instances = config.claudeCode?.instances ?? [];
  }

  /**
   * Find the best available Claude Code instance.
   * Prefers instances that aren't rate-limited.
   * For rate-limited instances, checks if reset time has passed.
   */
  findAvailableInstance(): ClaudeCodeInstance | undefined {
    const now = Date.now();

    for (const instance of this.instances) {
      // Check if rate limit has expired
      if (instance.rateLimited && instance.rateLimitResetAt && now > instance.rateLimitResetAt) {
        instance.rateLimited = false;
        instance.rateLimitedAt = undefined;
        instance.rateLimitResetAt = undefined;
        log.info(`Rate limit expired for ${instance.subscription}@${instance.host}`);
      }

      if (!instance.rateLimited) {
        return instance;
      }
    }

    return undefined;
  }

  /**
   * Mark an instance as rate-limited.
   */
  markRateLimited(instance: ClaudeCodeInstance): void {
    instance.rateLimited = true;
    instance.rateLimitedAt = Date.now();
    instance.rateLimitResetAt = Date.now() + RATE_LIMIT_RESET_MS;
    log.warn(`Rate limited: ${instance.subscription}@${instance.host}`);
  }

  /**
   * Route a request to the best available backend.
   */
  async route(agentId: string, task: string): Promise<RouteResult> {
    if (!this.config.enabled) {
      return {
        source: "api",
        estimatedCost: -1, // Unknown, use API
        message: "Smart routing disabled, using API",
      };
    }

    // 1. Try Claude Code (free)
    const instance = this.findAvailableInstance();
    if (instance) {
      return {
        source: "claude-code",
        instance,
        estimatedCost: 0,
        message: `Routed to Claude Code (${instance.subscription}@${instance.host})`,
      };
    }

    // 2. All rate-limited — check policy
    const onRateLimit = this.config.claudeCode?.onRateLimit ?? "api";

    if (onRateLimit === "queue") {
      const taskId = this.generateTaskId();
      return {
        source: "queued",
        estimatedCost: 0,
        taskId,
        message: `All Claude Code instances rate-limited. Task queued: ${taskId}`,
      };
    }

    if (onRateLimit === "notify") {
      return {
        source: "failed",
        estimatedCost: 0,
        message: "All Claude Code instances rate-limited. Admin notified.",
      };
    }

    // Default: fall back to API
    return {
      source: "api",
      estimatedCost: -1,
      message: "All Claude Code instances rate-limited, falling back to API",
    };
  }

  /**
   * Get status of all instances.
   */
  getStatus(): { total: number; available: number; rateLimited: number; instances: ClaudeCodeInstance[] } {
    const available = this.instances.filter((i) => !i.rateLimited).length;
    return {
      total: this.instances.length,
      available,
      rateLimited: this.instances.length - available,
      instances: this.instances,
    };
  }

  /**
   * Get estimated time until next instance becomes available.
   */
  getNextAvailableTime(): number | undefined {
    const now = Date.now();
    let earliest: number | undefined;

    for (const instance of this.instances) {
      if (!instance.rateLimited) return 0; // Already available
      if (instance.rateLimitResetAt) {
        const timeLeft = instance.rateLimitResetAt - now;
        if (timeLeft > 0 && (earliest === undefined || timeLeft < earliest)) {
          earliest = timeLeft;
        }
      }
    }

    return earliest;
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
