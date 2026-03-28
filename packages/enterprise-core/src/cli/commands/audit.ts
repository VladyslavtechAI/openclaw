import type { EnterpriseConfig } from "../../config/EnterpriseConfig.js";
import { colorize } from "../formatters.js";

export const description = "Run a security audit and produce a scored report";

// ─── Finding Types ──────────────────────────────────────────────────────────

type FindingLevel = "PASS" | "WARN" | "FAIL";

interface Finding {
  level: FindingLevel;
  description: string;
  /** Points awarded (positive) or deducted (zero) for this check */
  points: number;
  /** Maximum possible points for this check */
  maxPoints: number;
}

// ─── Check Definitions ─────────────────────────────────────────────────────

function checkInjectionShield(config: EnterpriseConfig): Finding {
  const shield = config.security.injectionShield;
  if (!shield.enabled) {
    return { level: "FAIL", description: "Injection shield is disabled", points: 0, maxPoints: 15 };
  }
  if (shield.mode === "strict") {
    return { level: "PASS", description: "Injection shield enabled in strict mode", points: 15, maxPoints: 15 };
  }
  if (shield.mode === "moderate") {
    return { level: "WARN", description: "Injection shield enabled but not in strict mode", points: 8, maxPoints: 15 };
  }
  return { level: "WARN", description: "Injection shield in permissive mode (weak protection)", points: 4, maxPoints: 15 };
}

function checkDlp(config: EnterpriseConfig): Finding {
  const dlp = config.security.dlp;
  if (!dlp.enabled) {
    return { level: "FAIL", description: "DLP (Data Loss Prevention) is disabled", points: 0, maxPoints: 15 };
  }
  if (dlp.piiTypes.length >= 4) {
    return { level: "PASS", description: "DLP enabled with comprehensive PII type coverage", points: 15, maxPoints: 15 };
  }
  return { level: "WARN", description: `DLP enabled but only covers ${dlp.piiTypes.length} PII types`, points: 8, maxPoints: 15 };
}

function checkNetworkPolicy(config: EnterpriseConfig): Finding {
  const net = config.security.networkPolicy;
  if (!net.enabled) {
    return { level: "FAIL", description: "Network policy is disabled", points: 0, maxPoints: 10 };
  }
  if (!net.blockPrivateRanges) {
    return { level: "WARN", description: "Network policy enabled but private ranges are not blocked", points: 5, maxPoints: 10 };
  }
  return { level: "PASS", description: "Network policy enabled with private range blocking", points: 10, maxPoints: 10 };
}

function checkFilesystemPolicy(config: EnterpriseConfig): Finding {
  const fs = config.security.filesystemPolicy;
  if (!fs.enabled) {
    return { level: "FAIL", description: "Filesystem policy is disabled", points: 0, maxPoints: 10 };
  }
  if (fs.defaultMode === "restrictive") {
    return { level: "PASS", description: "Filesystem policy in restrictive mode", points: 10, maxPoints: 10 };
  }
  return { level: "WARN", description: "Filesystem policy enabled but in permissive mode", points: 5, maxPoints: 10 };
}

function checkContentSafety(config: EnterpriseConfig): Finding {
  const cs = config.security.contentSafety;
  if (!cs.enabled) {
    return { level: "FAIL", description: "Content safety is disabled", points: 0, maxPoints: 10 };
  }
  if (cs.threshold >= 0.8) {
    return { level: "PASS", description: `Content safety enabled (threshold=${cs.threshold})`, points: 10, maxPoints: 10 };
  }
  return { level: "WARN", description: `Content safety threshold is low (${cs.threshold})`, points: 5, maxPoints: 10 };
}

function checkExfilGuard(config: EnterpriseConfig): Finding {
  const eg = config.security.exfilGuard;
  if (!eg.enabled) {
    return { level: "FAIL", description: "Exfiltration guard is disabled", points: 0, maxPoints: 10 };
  }
  const bothMonitors = eg.monitorClipboard && eg.monitorNetwork;
  if (bothMonitors) {
    return { level: "PASS", description: "Exfil guard enabled with clipboard and network monitoring", points: 10, maxPoints: 10 };
  }
  return { level: "WARN", description: "Exfil guard enabled but not all monitors are active", points: 5, maxPoints: 10 };
}

function checkBackdoorScanner(config: EnterpriseConfig): Finding {
  const bs = config.security.backdoorScanner;
  if (!bs.enabled) {
    return { level: "FAIL", description: "Backdoor scanner is disabled", points: 0, maxPoints: 10 };
  }
  if (bs.hashAlgorithm === "sha512") {
    return { level: "PASS", description: "Backdoor scanner enabled with SHA-512", points: 10, maxPoints: 10 };
  }
  return { level: "PASS", description: "Backdoor scanner enabled with SHA-256", points: 8, maxPoints: 10 };
}

function checkAuth(config: EnterpriseConfig): Finding {
  const auth = config.middleware.auth;
  if (!auth.enabled) {
    return { level: "FAIL", description: "Authentication is disabled", points: 0, maxPoints: 10 };
  }
  if (auth.method === "both") {
    return { level: "PASS", description: "Authentication enabled with dual methods (API key + JWT)", points: 10, maxPoints: 10 };
  }
  return { level: "PASS", description: `Authentication enabled (method=${auth.method})`, points: 8, maxPoints: 10 };
}

function checkAuditLogging(config: EnterpriseConfig): Finding {
  if (!config.compliance.auditLog) {
    return { level: "FAIL", description: "Audit logging is disabled", points: 0, maxPoints: 5 };
  }
  return { level: "PASS", description: "Audit logging is enabled", points: 5, maxPoints: 5 };
}

function checkRateLimiter(config: EnterpriseConfig): Finding {
  const rl = config.middleware.rateLimiter;
  if (!rl.enabled) {
    return { level: "WARN", description: "Rate limiter is disabled", points: 0, maxPoints: 5 };
  }
  return { level: "PASS", description: `Rate limiter enabled (${rl.maxRequests} req/${Math.round(rl.windowMs / 1000)}s)`, points: 5, maxPoints: 5 };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderFinding(finding: Finding): string {
  const levelTag = (() => {
    switch (finding.level) {
      case "PASS":
        return colorize("PASS", "green");
      case "WARN":
        return colorize("WARN", "yellow");
      case "FAIL":
        return colorize("FAIL", "red");
    }
  })();

  return `  ${levelTag}: ${finding.description} (${finding.points}/${finding.maxPoints} pts)`;
}

function scoreColor(score: number): string {
  if (score >= 80) return colorize(`${score}/100`, "green");
  if (score >= 50) return colorize(`${score}/100`, "yellow");
  return colorize(`${score}/100`, "red");
}

function gradeLabel(score: number): string {
  if (score >= 90) return colorize("A", "green");
  if (score >= 80) return colorize("B", "green");
  if (score >= 70) return colorize("C", "yellow");
  if (score >= 60) return colorize("D", "yellow");
  return colorize("F", "red");
}

// ─── Command Runner ─────────────────────────────────────────────────────────

export interface AuditArgs {
  config: EnterpriseConfig;
}

/**
 * Runs a security audit against the provided enterprise configuration.
 * Each check evaluates a security best-practice and yields points.
 * The overall score is computed as a percentage of total possible points.
 */
export async function run(args: AuditArgs): Promise<string> {
  const { config } = args;

  const checks: readonly (() => Finding)[] = [
    () => checkInjectionShield(config),
    () => checkDlp(config),
    () => checkNetworkPolicy(config),
    () => checkFilesystemPolicy(config),
    () => checkContentSafety(config),
    () => checkExfilGuard(config),
    () => checkBackdoorScanner(config),
    () => checkAuth(config),
    () => checkAuditLogging(config),
    () => checkRateLimiter(config),
  ];

  const findings: Finding[] = checks.map((check) => check());

  let totalPoints = 0;
  let maxPoints = 0;
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const f of findings) {
    totalPoints += f.points;
    maxPoints += f.maxPoints;
    switch (f.level) {
      case "PASS":
        passCount++;
        break;
      case "WARN":
        warnCount++;
        break;
      case "FAIL":
        failCount++;
        break;
    }
  }

  const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;

  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("=== Security Audit Report ===", "blue"));
  lines.push("");

  for (const f of findings) {
    lines.push(renderFinding(f));
  }

  lines.push("");
  lines.push(`  ${"─".repeat(50)}`);
  lines.push(`  Score:   ${scoreColor(score)}  (Grade: ${gradeLabel(score)})`);
  lines.push(
    `  Checks: ${colorize(String(passCount), "green")} passed, ` +
    `${colorize(String(warnCount), "yellow")} warnings, ` +
    `${colorize(String(failCount), "red")} failed`,
  );
  lines.push("");

  return lines.join("\n");
}
