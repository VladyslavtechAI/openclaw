#!/usr/bin/env node

import { DEFAULT_CONFIG } from "../config/defaults.js";
import { EventBus } from "../events/EventBus.js";
import { PluginContext } from "../plugin/PluginContext.js";
import { colorize } from "./formatters.js";

import * as statusCmd from "./commands/status.js";
import * as auditCmd from "./commands/audit.js";
import * as complianceCmd from "./commands/compliance.js";
import * as dlpScanCmd from "./commands/dlp-scan.js";
import * as costsCmd from "./commands/costs.js";
import * as healthCmd from "./commands/health.js";

// ─── Command Registry ───────────────────────────────────────────────────────

interface CommandEntry {
  description: string;
  run: (argv: string[]) => Promise<string>;
}

function createDefaultContext(): PluginContext {
  const eventBus = new EventBus();
  return new PluginContext(DEFAULT_CONFIG, eventBus, {
    security: {},
    tool: {},
    file: {},
    agent: {},
  });
}

const COMMANDS: Readonly<Record<string, CommandEntry>> = {
  status: {
    description: statusCmd.description,
    run: async () => {
      const context = createDefaultContext();
      return statusCmd.run({ context });
    },
  },
  audit: {
    description: auditCmd.description,
    run: async () => {
      return auditCmd.run({ config: DEFAULT_CONFIG });
    },
  },
  compliance: {
    description: complianceCmd.description,
    run: async (argv) => {
      const modeArg = extractFlag(argv, "--mode");
      const validModes = ["gdpr", "hipaa", "sox", "standard"] as const;
      type Mode = (typeof validModes)[number];

      let mode: Mode | undefined;
      if (modeArg !== undefined) {
        if (!isValidMode(modeArg, validModes)) {
          return `${colorize("Error:", "red")} Invalid mode "${modeArg}". Valid modes: ${validModes.join(", ")}\n`;
        }
        mode = modeArg;
      }

      return complianceCmd.run({ config: DEFAULT_CONFIG, mode });
    },
  },
  "dlp-scan": {
    description: dlpScanCmd.description,
    run: async (argv) => {
      const workspacePath = extractPositional(argv, 0);
      if (workspacePath === undefined) {
        return `${colorize("Error:", "red")} Missing required argument: <workspace-path>\n\nUsage: openclaw-enterprise dlp-scan <workspace-path>\n`;
      }
      return dlpScanCmd.run({ workspacePath });
    },
  },
  costs: {
    description: costsCmd.description,
    run: async () => {
      // Without a running system, show an empty cost report with default budget config
      const emptyMap = new Map<string, costsCmd.AgentCostData>();
      return costsCmd.run({
        costs: emptyMap,
        budgetConfig: DEFAULT_CONFIG.infrastructure.costGovernor,
      });
    },
  },
  health: {
    description: healthCmd.description,
    run: async () => {
      const context = createDefaultContext();
      return healthCmd.run({ context });
    },
  },
};

// ─── Argument Parsing ───────────────────────────────────────────────────────

function extractFlag(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (arg?.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

function extractPositional(argv: string[], index: number): string | undefined {
  // Filter out flags (--flag and --flag=value) and their values
  const positionals: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg?.startsWith("--")) {
      // If it's --flag value (not --flag=value), skip the next arg too
      if (!arg.includes("=")) {
        i += 2;
      } else {
        i += 1;
      }
    } else {
      if (arg !== undefined) {
        positionals.push(arg);
      }
      i += 1;
    }
  }
  return positionals[index];
}

function isValidMode(
  value: string,
  validModes: readonly string[],
): value is "gdpr" | "hipaa" | "sox" | "standard" {
  return validModes.includes(value);
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

// ─── Help Text ──────────────────────────────────────────────────────────────

function printHelp(): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("OpenClaw Enterprise CLI", "blue"));
  lines.push("");
  lines.push("Usage: openclaw-enterprise <command> [options]");
  lines.push("");
  lines.push("Commands:");

  const maxNameLen = Math.max(...Object.keys(COMMANDS).map((n) => n.length));
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(maxNameLen + 2)}  ${cmd.description}`);
  }

  lines.push("");
  lines.push("Options:");
  lines.push("  --help, -h        Show this help message");
  lines.push("");
  lines.push("Command-specific options:");
  lines.push("  compliance --mode <gdpr|hipaa|sox|standard>  Select compliance mode");
  lines.push("  dlp-scan <workspace-path>                    Path to scan for PII");
  lines.push("");

  return lines.join("\n");
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  // argv[0] = node, argv[1] = script path, argv[2+] = user args
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const commandArgs = args.slice(1);

  // Help flag
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    hasFlag(commandArgs, "--help") ||
    hasFlag(commandArgs, "-h")
  ) {
    process.stdout.write(printHelp());
    process.exitCode = 0;
    return;
  }

  // Look up command
  const command = COMMANDS[subcommand];
  if (command === undefined) {
    process.stderr.write(
      `${colorize("Error:", "red")} Unknown command "${subcommand}"\n\n` +
      `Run ${colorize("openclaw-enterprise --help", "blue")} to see available commands.\n`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const output = await command.run(commandArgs);
    process.stdout.write(output);
    process.exitCode = 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `${colorize("Error:", "red")} Command "${subcommand}" failed: ${message}\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${colorize("Fatal:", "red")} ${message}\n`);
  process.exitCode = 2;
});
