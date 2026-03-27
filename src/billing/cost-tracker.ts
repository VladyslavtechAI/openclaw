/**
 * Per-agent cost tracking with budget enforcement.
 * Stores usage data in JSONL files (no external dependencies).
 */

import fs from "node:fs";
import path from "node:path";
import { calculateRequestCost } from "./cost-models.js";

export type UsageRecord = {
  timestamp: number;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cost: number;
  sessionKey?: string;
};

export type AgentBudgetConfig = {
  /** Daily budget in USD. 0 = unlimited. */
  daily?: number;
  /** Model to downgrade to when budget exceeded. */
  modelOnExceed?: string;
  /** Whether to block requests when budget exceeded (vs downgrade). */
  blockOnExceed?: boolean;
};

export type BudgetCheckResult = {
  allowed: boolean;
  dailyCost: number;
  dailyBudget: number;
  percentUsed: number;
  downgradeTo?: string;
};

/**
 * Cost tracker that writes to JSONL files.
 * One file per day: usage-YYYY-MM-DD.jsonl
 */
export class CostTracker {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  /**
   * Record a request's token usage and cost.
   */
  trackRequest(
    agentId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens = 0,
    sessionKey?: string,
  ): UsageRecord {
    const cost = calculateRequestCost(model, inputTokens, outputTokens, cachedInputTokens);
    const record: UsageRecord = {
      timestamp: Date.now(),
      agentId,
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cost,
      sessionKey,
    };

    this.appendRecord(record);
    return record;
  }

  /**
   * Check if agent is within budget.
   */
  checkBudget(agentId: string, budget: AgentBudgetConfig): BudgetCheckResult {
    const dailyCost = this.getDailyCost(agentId);
    const dailyBudget = budget.daily ?? 0;

    if (dailyBudget === 0) {
      return { allowed: true, dailyCost, dailyBudget, percentUsed: 0 };
    }

    const percentUsed = (dailyCost / dailyBudget) * 100;
    const exceeded = dailyCost >= dailyBudget;

    if (exceeded && budget.blockOnExceed) {
      return { allowed: false, dailyCost, dailyBudget, percentUsed };
    }

    if (exceeded && budget.modelOnExceed) {
      return {
        allowed: true,
        dailyCost,
        dailyBudget,
        percentUsed,
        downgradeTo: budget.modelOnExceed,
      };
    }

    return { allowed: !exceeded, dailyCost, dailyBudget, percentUsed };
  }

  /**
   * Get total cost for an agent today.
   */
  getDailyCost(agentId: string, date?: Date): number {
    const records = this.getDailyRecords(date);
    return records
      .filter((r) => r.agentId === agentId)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * Get total cost across all agents for today.
   */
  getTotalDailyCost(date?: Date): number {
    const records = this.getDailyRecords(date);
    return records.reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * Get cost breakdown by agent for today.
   */
  getDailyCostByAgent(date?: Date): Map<string, number> {
    const records = this.getDailyRecords(date);
    const costs = new Map<string, number>();

    for (const record of records) {
      const current = costs.get(record.agentId) ?? 0;
      costs.set(record.agentId, current + record.cost);
    }

    return costs;
  }

  /**
   * Get cost breakdown by model for today.
   */
  getDailyCostByModel(date?: Date): Map<string, number> {
    const records = this.getDailyRecords(date);
    const costs = new Map<string, number>();

    for (const record of records) {
      const current = costs.get(record.model) ?? 0;
      costs.set(record.model, current + record.cost);
    }

    return costs;
  }

  /**
   * Get token usage summary for an agent.
   */
  getAgentUsageSummary(
    agentId: string,
    date?: Date,
  ): { totalInput: number; totalOutput: number; totalCost: number; requestCount: number } {
    const records = this.getDailyRecords(date).filter((r) => r.agentId === agentId);

    return {
      totalInput: records.reduce((s, r) => s + r.inputTokens, 0),
      totalOutput: records.reduce((s, r) => s + r.outputTokens, 0),
      totalCost: records.reduce((s, r) => s + r.cost, 0),
      requestCount: records.length,
    };
  }

  /**
   * Read all records for a given day.
   */
  private getDailyRecords(date?: Date): UsageRecord[] {
    const filePath = this.getDailyFilePath(date);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as UsageRecord);
    } catch {
      return [];
    }
  }

  /**
   * Append a record to today's file.
   */
  private appendRecord(record: UsageRecord): void {
    const filePath = this.getDailyFilePath();
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
  }

  /**
   * Get file path for a given day.
   */
  private getDailyFilePath(date?: Date): string {
    const d = date ?? new Date();
    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this.dataDir, `usage-${dateStr}.jsonl`);
  }
}
