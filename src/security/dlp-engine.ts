/**
 * Data Loss Prevention engine.
 * Detects and blocks credential/sensitive data leaks in outbound communications.
 */

export type DlpAction = "block" | "redact" | "warn" | "log";

export type DlpPattern = {
  name: string;
  pattern: RegExp;
  category: "credential" | "pii" | "financial" | "internal";
  defaultAction: DlpAction;
};

export type DlpResult = {
  action: DlpAction;
  findings: DlpFinding[];
  sanitized?: string;
};

export type DlpFinding = {
  pattern: string;
  category: string;
  position: number;
  preview: string; // Redacted preview
};

const DEFAULT_PATTERNS: DlpPattern[] = [
  // API Keys & Tokens
  { name: "anthropic_api_key", pattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g, category: "credential", defaultAction: "block" },
  { name: "anthropic_oauth", pattern: /sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}/g, category: "credential", defaultAction: "block" },
  { name: "openai_key", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g, category: "credential", defaultAction: "block" },
  { name: "github_token", pattern: /ghp_[A-Za-z0-9]{36}/g, category: "credential", defaultAction: "block" },
  { name: "github_fine_grained", pattern: /github_pat_[A-Za-z0-9_]{22,}/g, category: "credential", defaultAction: "block" },
  { name: "google_api_key", pattern: /AIzaSy[A-Za-z0-9_-]{33}/g, category: "credential", defaultAction: "block" },
  { name: "aws_access_key", pattern: /AKIA[A-Z0-9]{16}/g, category: "credential", defaultAction: "block" },
  { name: "generic_api_key", pattern: /['"](sk|api|key|token|secret|password)['"]?\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/gi, category: "credential", defaultAction: "warn" },

  // SSH/Crypto
  { name: "private_key", pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|ED25519\s+)?PRIVATE\s+KEY-----/g, category: "credential", defaultAction: "block" },

  // PII
  { name: "email_address", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, category: "pii", defaultAction: "warn" },
  { name: "phone_number", pattern: /\+\d{1,3}\s?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}/g, category: "pii", defaultAction: "warn" },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, category: "pii", defaultAction: "block" },

  // Financial
  { name: "credit_card", pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, category: "financial", defaultAction: "block" },
  { name: "iban", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g, category: "financial", defaultAction: "warn" },
];

/**
 * DLP Engine with configurable patterns and actions.
 */
export class DlpEngine {
  private patterns: DlpPattern[];
  private defaultAction: DlpAction;
  private exemptAgents: Set<string>;

  constructor(config: {
    patterns?: DlpPattern[];
    defaultAction?: DlpAction;
    exemptAgents?: string[];
  } = {}) {
    this.patterns = config.patterns ?? DEFAULT_PATTERNS;
    this.defaultAction = config.defaultAction ?? "block";
    this.exemptAgents = new Set(config.exemptAgents ?? []);
  }

  /**
   * Scan content for DLP violations.
   */
  scan(content: string, agentId?: string): DlpResult {
    if (agentId && this.exemptAgents.has(agentId)) {
      return { action: "log", findings: [] };
    }

    const findings: DlpFinding[] = [];
    let highestAction: DlpAction = "log";

    for (const p of this.patterns) {
      // Reset regex lastIndex for global patterns
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const matchText = match[0];
        findings.push({
          pattern: p.name,
          category: p.category,
          position: match.index,
          preview: `${matchText.slice(0, 6)}...${matchText.slice(-4)}`,
        });
        if (this.isHigherAction(p.defaultAction, highestAction)) {
          highestAction = p.defaultAction;
        }
      }
    }

    if (findings.length === 0) {
      return { action: "log", findings: [] };
    }

    return {
      action: highestAction,
      findings,
      sanitized: highestAction === "redact" ? this.redact(content) : undefined,
    };
  }

  /**
   * Redact sensitive content.
   */
  redact(content: string): string {
    let result = content;
    for (const p of this.patterns) {
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      result = result.replace(regex, `[REDACTED:${p.name}]`);
    }
    return result;
  }

  private isHigherAction(a: DlpAction, b: DlpAction): boolean {
    const order: Record<DlpAction, number> = { log: 0, warn: 1, redact: 2, block: 3 };
    return order[a] > order[b];
  }
}
