import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run as runAudit } from "../src/cli/commands/audit.js";
import { run as runCompliance } from "../src/cli/commands/compliance.js";
import { run as runCosts } from "../src/cli/commands/costs.js";
import { run as runDlpScan } from "../src/cli/commands/dlp-scan.js";
import {
  formatTable,
  formatBytes,
  formatDuration,
  formatCurrency,
  colorize,
} from "../src/cli/formatters.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

// ═══════════════════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════════════════

describe("formatters", () => {
  it("formats a table", () => {
    const result = formatTable(
      ["Name", "Value"],
      [
        ["foo", "1"],
        ["bar", "2"],
      ],
    );
    expect(result).toContain("Name");
    expect(result).toContain("foo");
    expect(result).toContain("bar");
  });

  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1_048_576)).toBe("1.00 MB");
    expect(formatBytes(1_073_741_824)).toBe("1.00 GB");
  });

  it("formats duration", () => {
    expect(formatDuration(50)).toBe("50ms");
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(3_661_000)).toBe("1h 1m");
  });

  it("formats currency", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(0.5)).toBe("$0.50");
  });

  it("colorizes text", () => {
    // colorize skips ANSI codes when stdout is not a TTY (test environment)
    const red = colorize("error", "red");
    expect(red).toContain("error");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit command
// ═══════════════════════════════════════════════════════════════════════════

describe("audit command", () => {
  it("scores default config highly", async () => {
    const output = await runAudit({ config: DEFAULT_CONFIG });
    expect(output).toContain("Score");
    expect(output).toContain("PASS");
  });

  it("warns on disabled security modules", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.security.injectionShield.enabled = false;
    config.security.dlp.enabled = false;

    const output = await runAudit({ config });
    expect(output).toContain("FAIL");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Compliance command
// ═══════════════════════════════════════════════════════════════════════════

describe("compliance command", () => {
  it("checks standard compliance", async () => {
    const output = await runCompliance({ config: DEFAULT_CONFIG });
    expect(output).toContain("Compliance");
  });

  it("checks GDPR compliance", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.compliance.mode = "gdpr";

    const output = await runCompliance({ config, mode: "gdpr" });
    expect(output).toContain("GDPR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Costs command
// ═══════════════════════════════════════════════════════════════════════════

describe("costs command", () => {
  it("shows cost report", async () => {
    const costs = new Map([
      ["agent-1", { totalUsd: 45.5, requests: 1200, avgLatencyMs: 230 }],
      ["agent-2", { totalUsd: 12.3, requests: 300, avgLatencyMs: 180 }],
    ]);

    const output = await runCosts({
      costs,
      budgetConfig: DEFAULT_CONFIG.infrastructure.costGovernor,
    });
    expect(output).toContain("agent-1");
    expect(output).toContain("$45.50");
  });

  it("handles empty cost data", async () => {
    const output = await runCosts({
      costs: new Map(),
      budgetConfig: DEFAULT_CONFIG.infrastructure.costGovernor,
    });
    expect(output).toContain("No");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DLP Scan command
// ═══════════════════════════════════════════════════════════════════════════

describe("dlp-scan command", () => {
  it("detects PII patterns in workspace files", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "dlp-test-"));
    try {
      writeFileSync(
        join(tmpDir, "test.txt"),
        "Email: user@example.com\nSSN: 123-45-6789\n",
      );

      const output = await runDlpScan({ workspacePath: tmpDir });
      expect(output).toContain("test.txt");
      expect(output).toContain("Email");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports clean when no PII found", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "dlp-clean-"));
    try {
      writeFileSync(
        join(tmpDir, "clean.txt"),
        "This is a clean document with no PII.\n",
      );

      const output = await runDlpScan({ workspacePath: tmpDir });
      expect(output).toContain("No PII");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles non-existent path", async () => {
    const output = await runDlpScan({ workspacePath: "/tmp/nonexistent-dlp-path-xyz" });
    expect(output).toContain("Error");
  });
});
