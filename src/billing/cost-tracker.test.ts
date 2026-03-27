/**
 * Tests for cost tracking system.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateRequestCost, getModelPricing } from "./cost-models.js";
import { CostTracker } from "./cost-tracker.js";

describe("cost-models", () => {
  describe("getModelPricing", () => {
    it("returns Opus pricing", () => {
      const pricing = getModelPricing("anthropic/claude-opus-4-6");
      expect(pricing.inputPerMillion).toBe(15);
      expect(pricing.outputPerMillion).toBe(75);
    });

    it("returns Sonnet pricing", () => {
      const pricing = getModelPricing("anthropic/claude-sonnet-4-5");
      expect(pricing.inputPerMillion).toBe(3);
      expect(pricing.outputPerMillion).toBe(15);
    });

    it("returns zero for Ollama models", () => {
      const pricing = getModelPricing("ollama/qwen3:32b");
      expect(pricing.inputPerMillion).toBe(0);
      expect(pricing.outputPerMillion).toBe(0);
    });

    it("returns zero for unknown models", () => {
      const pricing = getModelPricing("unknown/model");
      expect(pricing.inputPerMillion).toBe(0);
    });

    it("handles versioned model names", () => {
      const pricing = getModelPricing("anthropic/claude-opus-4-6-20260315");
      expect(pricing.inputPerMillion).toBe(15);
    });
  });

  describe("calculateRequestCost", () => {
    it("calculates Opus cost correctly", () => {
      // 100K input + 10K output
      const cost = calculateRequestCost("anthropic/claude-opus-4-6", 100_000, 10_000);
      expect(cost).toBeCloseTo(2.25, 2); // (100K/1M * $15) + (10K/1M * $75) = $1.50 + $0.75
    });

    it("applies cached input discount", () => {
      const costNonCached = calculateRequestCost("anthropic/claude-opus-4-6", 100_000, 10_000, 0);
      const costCached = calculateRequestCost("anthropic/claude-opus-4-6", 100_000, 10_000, 80_000);
      expect(costCached).toBeLessThan(costNonCached);
    });

    it("returns zero for Ollama", () => {
      const cost = calculateRequestCost("ollama/qwen3:32b", 1_000_000, 100_000);
      expect(cost).toBe(0);
    });
  });
});

describe("CostTracker", () => {
  let tracker: CostTracker;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-tracker-test-"));
    tracker = new CostTracker(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("trackRequest", () => {
    it("records and returns usage data", () => {
      const record = tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 50_000, 5_000);
      expect(record.agentId).toBe("boris");
      expect(record.model).toBe("anthropic/claude-opus-4-6");
      expect(record.inputTokens).toBe(50_000);
      expect(record.outputTokens).toBe(5_000);
      expect(record.cost).toBeGreaterThan(0);
      expect(record.timestamp).toBeGreaterThan(0);
    });

    it("persists to JSONL file", () => {
      tracker.trackRequest("jarvis", "anthropic/claude-opus-4-6", 10_000, 1_000);
      const dateStr = new Date().toISOString().slice(0, 10);
      const filePath = path.join(tmpDir, `usage-${dateStr}.jsonl`);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.agentId).toBe("jarvis");
    });
  });

  describe("getDailyCost", () => {
    it("returns zero for no records", () => {
      expect(tracker.getDailyCost("nobody")).toBe(0);
    });

    it("sums costs for an agent", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 50_000, 5_000);
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 50_000, 5_000);
      const cost = tracker.getDailyCost("boris");
      expect(cost).toBeGreaterThan(0);
    });

    it("separates costs by agent", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 100_000, 10_000);
      tracker.trackRequest("alex", "anthropic/claude-sonnet-4-5", 100_000, 10_000);
      const borisCost = tracker.getDailyCost("boris");
      const alexCost = tracker.getDailyCost("alex");
      expect(borisCost).toBeGreaterThan(alexCost); // Opus > Sonnet
    });
  });

  describe("getDailyCostByAgent", () => {
    it("returns breakdown", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 50_000, 5_000);
      tracker.trackRequest("alex", "anthropic/claude-sonnet-4-5", 50_000, 5_000);
      const breakdown = tracker.getDailyCostByAgent();
      expect(breakdown.size).toBe(2);
      expect(breakdown.has("boris")).toBe(true);
      expect(breakdown.has("alex")).toBe(true);
    });
  });

  describe("checkBudget", () => {
    it("allows when within budget", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 10_000, 1_000);
      const result = tracker.checkBudget("boris", { daily: 100 });
      expect(result.allowed).toBe(true);
      expect(result.percentUsed).toBeLessThan(100);
    });

    it("blocks when exceeding budget with blockOnExceed", () => {
      // Track enough to exceed $1 budget
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 100_000, 50_000);
      const result = tracker.checkBudget("boris", { daily: 1, blockOnExceed: true });
      expect(result.allowed).toBe(false);
      expect(result.percentUsed).toBeGreaterThan(100);
    });

    it("downgrades model when exceeding budget", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 100_000, 50_000);
      const result = tracker.checkBudget("boris", {
        daily: 1,
        modelOnExceed: "anthropic/claude-sonnet-4-5",
      });
      expect(result.allowed).toBe(true);
      expect(result.downgradeTo).toBe("anthropic/claude-sonnet-4-5");
    });

    it("allows unlimited when daily=0", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 1_000_000, 500_000);
      const result = tracker.checkBudget("boris", { daily: 0 });
      expect(result.allowed).toBe(true);
    });
  });

  describe("getAgentUsageSummary", () => {
    it("returns complete summary", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 50_000, 5_000, 20_000);
      tracker.trackRequest("boris", "anthropic/claude-sonnet-4-5", 30_000, 3_000);
      const summary = tracker.getAgentUsageSummary("boris");
      expect(summary.totalInput).toBe(80_000);
      expect(summary.totalOutput).toBe(8_000);
      expect(summary.requestCount).toBe(2);
      expect(summary.totalCost).toBeGreaterThan(0);
    });
  });

  describe("getDailyCostByModel", () => {
    it("returns model breakdown", () => {
      tracker.trackRequest("boris", "anthropic/claude-opus-4-6", 50_000, 5_000);
      tracker.trackRequest("boris", "anthropic/claude-sonnet-4-5", 50_000, 5_000);
      const breakdown = tracker.getDailyCostByModel();
      expect(breakdown.size).toBe(2);
    });
  });
});
