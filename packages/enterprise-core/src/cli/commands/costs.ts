import type { CostGovernorConfig } from "../../config/EnterpriseConfig.js";
import {
  formatTable,
  formatCurrency,
  formatDuration,
  colorize,
} from "../formatters.js";

export const description = "Display cost usage report with budget utilization";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentCostData {
  totalUsd: number;
  requests: number;
  avgLatencyMs: number;
}

export interface CostsArgs {
  /** Per-agent cost data keyed by agent ID */
  costs: Map<string, AgentCostData>;
  /** Cost governor configuration for budget limits */
  budgetConfig: CostGovernorConfig;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function utilizationBar(percent: number, width: number): string {
  const filled = Math.min(Math.round((percent / 100) * width), width);
  const empty = width - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);

  if (percent >= 90) return colorize(bar, "red");
  if (percent >= 70) return colorize(bar, "yellow");
  return colorize(bar, "green");
}

function percentColor(percent: number): string {
  const text = `${percent.toFixed(1)}%`;
  if (percent >= 90) return colorize(text, "red");
  if (percent >= 70) return colorize(text, "yellow");
  return colorize(text, "green");
}

// ─── Command Runner ─────────────────────────────────────────────────────────

/**
 * Produces a cost report showing per-agent spend, request counts,
 * average latencies, and overall budget utilization.
 */
export async function run(args: CostsArgs): Promise<string> {
  const { costs, budgetConfig } = args;

  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("=== Cost Report ===", "blue"));
  lines.push("");

  if (costs.size === 0) {
    lines.push(colorize("  No cost data available.", "gray"));
    lines.push("");
    return lines.join("\n");
  }

  // Build agent table
  const headers = ["Agent ID", "Total Cost", "Requests", "Avg Latency", "Agent Limit"];

  const sortedEntries = Array.from(costs.entries()).sort(
    (a, b) => b[1].totalUsd - a[1].totalUsd,
  );

  let grandTotalUsd = 0;
  let grandTotalRequests = 0;
  let totalWeightedLatency = 0;

  const rows: string[][] = [];

  for (const [agentId, data] of sortedEntries) {
    grandTotalUsd += data.totalUsd;
    grandTotalRequests += data.requests;
    totalWeightedLatency += data.avgLatencyMs * data.requests;

    const agentPercent = budgetConfig.perAgentLimitUsd > 0
      ? (data.totalUsd / budgetConfig.perAgentLimitUsd) * 100
      : 0;

    const costStr = agentPercent >= 90
      ? colorize(formatCurrency(data.totalUsd), "red")
      : agentPercent >= 70
        ? colorize(formatCurrency(data.totalUsd), "yellow")
        : formatCurrency(data.totalUsd);

    rows.push([
      agentId,
      costStr,
      String(data.requests),
      formatDuration(data.avgLatencyMs),
      formatCurrency(budgetConfig.perAgentLimitUsd),
    ]);
  }

  lines.push(formatTable(headers, rows));
  lines.push("");

  // Totals
  const avgLatencyOverall =
    grandTotalRequests > 0 ? totalWeightedLatency / grandTotalRequests : 0;

  lines.push(`  ${"─".repeat(55)}`);
  lines.push(`  Total Spend:       ${formatCurrency(grandTotalUsd)}`);
  lines.push(`  Total Requests:    ${grandTotalRequests}`);
  lines.push(`  Avg Latency:       ${formatDuration(avgLatencyOverall)}`);
  lines.push("");

  // Budget utilization
  const budgetPercent = budgetConfig.monthlyBudgetUsd > 0
    ? (grandTotalUsd / budgetConfig.monthlyBudgetUsd) * 100
    : 0;

  lines.push(`  Monthly Budget:    ${formatCurrency(budgetConfig.monthlyBudgetUsd)}`);
  lines.push(`  Utilization:       ${percentColor(budgetPercent)}  ${utilizationBar(budgetPercent, 30)}`);
  lines.push(`  Alert Threshold:   ${budgetConfig.alertAtPercent}%`);

  if (budgetPercent >= budgetConfig.alertAtPercent) {
    lines.push("");
    lines.push(`  ${colorize("WARNING: Budget utilization has reached the alert threshold!", "red")}`);
  }

  if (budgetPercent >= 100) {
    lines.push(`  ${colorize("CRITICAL: Monthly budget has been exceeded!", "red")}`);
  }

  lines.push("");
  return lines.join("\n");
}
