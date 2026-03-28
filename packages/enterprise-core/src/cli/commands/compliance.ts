import type { EnterpriseConfig, ComplianceConfig } from "../../config/EnterpriseConfig.js";
import { colorize } from "../formatters.js";

export const description = "Generate a compliance report for the selected regulatory mode";

// ─── Requirement Types ──────────────────────────────────────────────────────

interface Requirement {
  id: string;
  description: string;
  check: (config: EnterpriseConfig) => boolean;
}

type ComplianceMode = ComplianceConfig["mode"];

// ─── Shared Requirements ────────────────────────────────────────────────────

const COMMON_REQUIREMENTS: readonly Requirement[] = [
  {
    id: "COM-001",
    description: "Audit logging enabled",
    check: (c) => c.compliance.auditLog,
  },
  {
    id: "COM-002",
    description: "Authentication enabled",
    check: (c) => c.middleware.auth.enabled,
  },
  {
    id: "COM-003",
    description: "Rate limiting enabled",
    check: (c) => c.middleware.rateLimiter.enabled,
  },
  {
    id: "COM-004",
    description: "Injection shield enabled",
    check: (c) => c.security.injectionShield.enabled,
  },
  {
    id: "COM-005",
    description: "Exfiltration guard enabled",
    check: (c) => c.security.exfilGuard.enabled,
  },
];

// ─── Mode-Specific Requirements ─────────────────────────────────────────────

const GDPR_REQUIREMENTS: readonly Requirement[] = [
  {
    id: "GDPR-001",
    description: "DLP (Data Loss Prevention) enabled for PII detection",
    check: (c) => c.security.dlp.enabled,
  },
  {
    id: "GDPR-002",
    description: "PII data retention <= 30 days",
    check: (c) => c.compliance.dataRetention.piiDays <= 30,
  },
  {
    id: "GDPR-003",
    description: "DLP covers email PII type",
    check: (c) => c.security.dlp.enabled && c.security.dlp.piiTypes.includes("email"),
  },
  {
    id: "GDPR-004",
    description: "DLP covers phone PII type",
    check: (c) => c.security.dlp.enabled && c.security.dlp.piiTypes.includes("phone"),
  },
  {
    id: "GDPR-005",
    description: "Network policy enabled to control data flows",
    check: (c) => c.security.networkPolicy.enabled,
  },
  {
    id: "GDPR-006",
    description: "Content safety enabled",
    check: (c) => c.security.contentSafety.enabled,
  },
  {
    id: "GDPR-007",
    description: "Filesystem policy in restrictive mode",
    check: (c) => c.security.filesystemPolicy.enabled && c.security.filesystemPolicy.defaultMode === "restrictive",
  },
];

const HIPAA_REQUIREMENTS: readonly Requirement[] = [
  {
    id: "HIPAA-001",
    description: "DLP enabled for PHI/PII detection",
    check: (c) => c.security.dlp.enabled,
  },
  {
    id: "HIPAA-002",
    description: "Injection shield in strict mode",
    check: (c) => c.security.injectionShield.enabled && c.security.injectionShield.mode === "strict",
  },
  {
    id: "HIPAA-003",
    description: "Audit log retention >= 365 days (6-year requirement via external archive)",
    check: (c) => c.compliance.dataRetention.auditDays >= 365,
  },
  {
    id: "HIPAA-004",
    description: "Network policy blocks private ranges",
    check: (c) => c.security.networkPolicy.enabled && c.security.networkPolicy.blockPrivateRanges,
  },
  {
    id: "HIPAA-005",
    description: "Exfil guard monitors both clipboard and network",
    check: (c) =>
      c.security.exfilGuard.enabled &&
      c.security.exfilGuard.monitorClipboard &&
      c.security.exfilGuard.monitorNetwork,
  },
  {
    id: "HIPAA-006",
    description: "Backdoor scanner enabled for integrity verification",
    check: (c) => c.security.backdoorScanner.enabled,
  },
  {
    id: "HIPAA-007",
    description: "Filesystem policy enabled in restrictive mode",
    check: (c) => c.security.filesystemPolicy.enabled && c.security.filesystemPolicy.defaultMode === "restrictive",
  },
  {
    id: "HIPAA-008",
    description: "PII data retention <= 30 days",
    check: (c) => c.compliance.dataRetention.piiDays <= 30,
  },
];

const SOX_REQUIREMENTS: readonly Requirement[] = [
  {
    id: "SOX-001",
    description: "Audit log retention >= 365 days",
    check: (c) => c.compliance.dataRetention.auditDays >= 365,
  },
  {
    id: "SOX-002",
    description: "Cost governor enabled for financial controls",
    check: (c) => c.infrastructure.costGovernor.enabled,
  },
  {
    id: "SOX-003",
    description: "Cost alert threshold <= 80%",
    check: (c) => c.infrastructure.costGovernor.enabled && c.infrastructure.costGovernor.alertAtPercent <= 80,
  },
  {
    id: "SOX-004",
    description: "Authentication enabled with JWT or dual method",
    check: (c) => c.middleware.auth.enabled && (c.middleware.auth.method === "jwt" || c.middleware.auth.method === "both"),
  },
  {
    id: "SOX-005",
    description: "Backdoor scanner enabled for change management integrity",
    check: (c) => c.security.backdoorScanner.enabled,
  },
  {
    id: "SOX-006",
    description: "Agent hierarchy enabled with permission inheritance",
    check: (c) => c.infrastructure.agentHierarchy.enabled && c.infrastructure.agentHierarchy.inheritPermissions,
  },
];

// ─── Mode Registry ──────────────────────────────────────────────────────────

function getRequirementsForMode(mode: ComplianceMode): readonly Requirement[] {
  switch (mode) {
    case "gdpr":
      return [...COMMON_REQUIREMENTS, ...GDPR_REQUIREMENTS];
    case "hipaa":
      return [...COMMON_REQUIREMENTS, ...HIPAA_REQUIREMENTS];
    case "sox":
      return [...COMMON_REQUIREMENTS, ...SOX_REQUIREMENTS];
    case "standard":
      return COMMON_REQUIREMENTS;
  }
}

function modeName(mode: ComplianceMode): string {
  switch (mode) {
    case "gdpr":
      return "GDPR";
    case "hipaa":
      return "HIPAA";
    case "sox":
      return "SOX";
    case "standard":
      return "Standard";
  }
}

// ─── Command Runner ─────────────────────────────────────────────────────────

export interface ComplianceArgs {
  config: EnterpriseConfig;
  /** Override the compliance mode; if omitted, uses config.compliance.mode */
  mode?: ComplianceMode;
}

/**
 * Evaluates the configuration against the requirements for the selected
 * compliance mode and produces a detailed report.
 */
export async function run(args: ComplianceArgs): Promise<string> {
  const { config } = args;
  const mode = args.mode ?? config.compliance.mode;
  const requirements = getRequirementsForMode(mode);

  let metCount = 0;
  let unmetCount = 0;

  const lines: string[] = [];

  lines.push("");
  lines.push(colorize(`=== Compliance Report: ${modeName(mode)} ===`, "blue"));
  lines.push("");

  for (const req of requirements) {
    const met = req.check(config);
    if (met) {
      metCount++;
      lines.push(`  ${colorize("[MET]", "green")}     ${req.id}: ${req.description}`);
    } else {
      unmetCount++;
      lines.push(`  ${colorize("[UNMET]", "red")}   ${req.id}: ${req.description}`);
    }
  }

  lines.push("");
  lines.push(`  ${"─".repeat(55)}`);

  const total = requirements.length;
  const pct = total > 0 ? Math.round((metCount / total) * 100) : 0;
  const pctStr = pct === 100
    ? colorize(`${pct}%`, "green")
    : pct >= 80
      ? colorize(`${pct}%`, "yellow")
      : colorize(`${pct}%`, "red");

  lines.push(
    `  Requirements: ${colorize(String(metCount), "green")} met, ` +
    `${colorize(String(unmetCount), "red")} unmet  (${total} total)`,
  );
  lines.push(`  Compliance:   ${pctStr}`);

  if (unmetCount === 0) {
    lines.push("");
    lines.push(`  ${colorize("All requirements met for " + modeName(mode) + " compliance.", "green")}`);
  } else {
    lines.push("");
    lines.push(`  ${colorize(`${unmetCount} requirement(s) must be addressed for ${modeName(mode)} compliance.`, "red")}`);
  }

  lines.push("");

  return lines.join("\n");
}
