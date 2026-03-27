/**
 * Tests for smart router.
 */

import { describe, expect, it } from "vitest";
import type { ClaudeCodeInstance, SmartRouterConfig } from "./smart-router.js";
import { SmartRouter } from "./smart-router.js";

function makeInstance(
  host: string,
  subscription: string,
  rateLimited = false,
): ClaudeCodeInstance {
  return { host, user: "test", subscription, rateLimited };
}

function makeConfig(overrides: Partial<SmartRouterConfig> = {}): SmartRouterConfig {
  return {
    enabled: true,
    claudeCode: {
      instances: [
        makeInstance("100.72.101.3", "max1"),
        makeInstance("100.81.48.45", "max2"),
        makeInstance("100.104.24.11", "max3"),
      ],
      onRateLimit: "queue",
      queueRetryMinutes: 15,
    },
    ...overrides,
  };
}

describe("SmartRouter", () => {
  describe("findAvailableInstance", () => {
    it("returns first available instance", () => {
      const router = new SmartRouter(makeConfig());
      const instance = router.findAvailableInstance();
      expect(instance).toBeDefined();
      expect(instance?.subscription).toBe("max1");
    });

    it("skips rate-limited instances", () => {
      const config = makeConfig();
      config.claudeCode!.instances[0].rateLimited = true;
      const router = new SmartRouter(config);
      const instance = router.findAvailableInstance();
      expect(instance?.subscription).toBe("max2");
    });

    it("returns undefined when all rate-limited", () => {
      const config = makeConfig();
      config.claudeCode!.instances.forEach((i) => { i.rateLimited = true; });
      const router = new SmartRouter(config);
      expect(router.findAvailableInstance()).toBeUndefined();
    });

    it("resets expired rate limits", () => {
      const config = makeConfig();
      const instance = config.claudeCode!.instances[0];
      instance.rateLimited = true;
      instance.rateLimitedAt = Date.now() - 6 * 60 * 60 * 1000; // 6h ago
      instance.rateLimitResetAt = Date.now() - 1000; // Expired

      const router = new SmartRouter(config);
      const found = router.findAvailableInstance();
      expect(found?.subscription).toBe("max1");
      expect(found?.rateLimited).toBe(false);
    });
  });

  describe("markRateLimited", () => {
    it("marks instance as rate-limited", () => {
      const router = new SmartRouter(makeConfig());
      const instance = router.findAvailableInstance()!;
      router.markRateLimited(instance);
      expect(instance.rateLimited).toBe(true);
      expect(instance.rateLimitedAt).toBeGreaterThan(0);
      expect(instance.rateLimitResetAt).toBeGreaterThan(Date.now());
    });
  });

  describe("route", () => {
    it("routes to Claude Code when available", async () => {
      const router = new SmartRouter(makeConfig());
      const result = await router.route("boris", "fix a bug");
      expect(result.source).toBe("claude-code");
      expect(result.estimatedCost).toBe(0);
      expect(result.instance).toBeDefined();
    });

    it("queues when all rate-limited and policy=queue", async () => {
      const config = makeConfig();
      config.claudeCode!.instances.forEach((i) => { i.rateLimited = true; });
      config.claudeCode!.onRateLimit = "queue";
      const router = new SmartRouter(config);
      const result = await router.route("boris", "fix a bug");
      expect(result.source).toBe("queued");
      expect(result.taskId).toBeDefined();
    });

    it("falls back to API when policy=api", async () => {
      const config = makeConfig();
      config.claudeCode!.instances.forEach((i) => { i.rateLimited = true; });
      config.claudeCode!.onRateLimit = "api";
      const router = new SmartRouter(config);
      const result = await router.route("boris", "fix a bug");
      expect(result.source).toBe("api");
    });

    it("notifies when policy=notify", async () => {
      const config = makeConfig();
      config.claudeCode!.instances.forEach((i) => { i.rateLimited = true; });
      config.claudeCode!.onRateLimit = "notify";
      const router = new SmartRouter(config);
      const result = await router.route("boris", "fix a bug");
      expect(result.source).toBe("failed");
    });

    it("falls back to API when disabled", async () => {
      const router = new SmartRouter({ enabled: false });
      const result = await router.route("boris", "fix a bug");
      expect(result.source).toBe("api");
    });
  });

  describe("getStatus", () => {
    it("returns correct status", () => {
      const config = makeConfig();
      config.claudeCode!.instances[0].rateLimited = true;
      const router = new SmartRouter(config);
      const status = router.getStatus();
      expect(status.total).toBe(3);
      expect(status.available).toBe(2);
      expect(status.rateLimited).toBe(1);
    });
  });

  describe("getNextAvailableTime", () => {
    it("returns 0 when instance available", () => {
      const router = new SmartRouter(makeConfig());
      expect(router.getNextAvailableTime()).toBe(0);
    });

    it("returns time until next reset", () => {
      const config = makeConfig();
      config.claudeCode!.instances.forEach((i) => {
        i.rateLimited = true;
        i.rateLimitResetAt = Date.now() + 3_600_000; // 1h
      });
      // Set one to reset sooner
      config.claudeCode!.instances[1].rateLimitResetAt = Date.now() + 1_800_000; // 30min
      const router = new SmartRouter(config);
      const time = router.getNextAvailableTime();
      expect(time).toBeDefined();
      expect(time!).toBeLessThanOrEqual(1_800_000);
      expect(time!).toBeGreaterThan(0);
    });
  });
});
