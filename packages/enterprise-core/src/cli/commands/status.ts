import type { ModuleHealth, PluginContext } from "../../plugin/PluginContext.js";
import {
  formatTable,
  formatDuration,
  colorize,
} from "../formatters.js";

export const description = "Show enterprise module status and health summary";

// ─── Status Rendering ───────────────────────────────────────────────────────

function statusColor(status: ModuleHealth["status"]): string {
  switch (status) {
    case "healthy":
      return colorize("healthy", "green");
    case "degraded":
      return colorize("degraded", "yellow");
    case "down":
      return colorize("down", "red");
    case "disabled":
      return colorize("disabled", "gray");
  }
}

function overallStatus(summary: {
  healthy: number;
  degraded: number;
  down: number;
}): string {
  if (summary.down > 0) {
    return colorize("UNHEALTHY", "red");
  }
  if (summary.degraded > 0) {
    return colorize("DEGRADED", "yellow");
  }
  return colorize("HEALTHY", "green");
}

// ─── Command Runner ─────────────────────────────────────────────────────────

export interface StatusArgs {
  context: PluginContext;
}

/**
 * Produces a formatted status report of all registered enterprise modules.
 *
 * Output includes:
 *   - A table of Module | Status | Message
 *   - Uptime
 *   - Summary counts: healthy / degraded / down / disabled
 */
export async function run(args: StatusArgs): Promise<string> {
  const { context } = args;
  const modules = context.getAllModuleHealth();
  const summary = context.getHealthSummary();
  const uptime = context.getUptime();

  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("=== OpenClaw Enterprise Status ===", "blue"));
  lines.push("");

  // Build module table
  if (modules.length === 0) {
    lines.push(colorize("  No modules registered.", "gray"));
  } else {
    const headers = ["Module", "Status", "Message"];
    const rows: string[][] = modules.map((m) => [
      m.name,
      statusColor(m.status),
      m.message ?? "-",
    ]);
    lines.push(formatTable(headers, rows));
  }

  lines.push("");

  // Summary line
  lines.push(
    `  Overall: ${overallStatus(summary)}  |  ` +
    `${colorize(String(summary.healthy), "green")} healthy, ` +
    `${colorize(String(summary.degraded), "yellow")} degraded, ` +
    `${colorize(String(summary.down), "red")} down, ` +
    `${colorize(String(summary.disabled), "gray")} disabled  ` +
    `(${summary.total} total)`,
  );

  // Uptime
  lines.push(`  Uptime:  ${formatDuration(uptime)}`);
  lines.push("");

  return lines.join("\n");
}
