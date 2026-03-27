/**
 * Data exfiltration prevention guard.
 * Analyzes exec commands and outbound messages for data theft attempts.
 */

import type { ExecExfilPattern } from "./injection-patterns.js";
import { EXEC_EXFIL_PATTERNS } from "./injection-patterns.js";

export type ExfilRisk = {
  allowed: boolean;
  score: number;
  findings: ExfilFinding[];
};

export type ExfilFinding = {
  type: string;
  confidence: number;
  category: string;
  matchedText?: string;
};

/** Credential patterns for outbound message scanning. */
const CREDENTIAL_PATTERNS = [
  { name: "anthropic_key", pattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/ },
  { name: "anthropic_oat", pattern: /sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}/ },
  { name: "openai_key", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { name: "openai_key_v2", pattern: /sk-[A-Za-z0-9]{40,}/ },
  { name: "github_token", pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: "github_fine_grained", pattern: /github_pat_[A-Za-z0-9_]{80,}/ },
  { name: "google_api_key", pattern: /AIzaSy[A-Za-z0-9_-]{33}/ },
  { name: "aws_access_key", pattern: /AKIA[A-Z0-9]{16}/ },
  { name: "ssh_private_key", pattern: /-----BEGIN\s+(RSA\s+|EC\s+|ED25519\s+)?PRIVATE\s+KEY-----/ },
  { name: "generic_token", pattern: /\b(token|password|secret|credential)\s*[:=]\s*['"]\S{16,}['"]/i },
  { name: "base64_long", pattern: /[A-Za-z0-9+/]{100,}={0,2}/ }, // Suspicious base64 blob
];

/**
 * Data exfiltration guard.
 */
export class ExfilGuard {
  private customPatterns: ExecExfilPattern[];
  private blockThreshold: number;

  constructor(config: { customPatterns?: ExecExfilPattern[]; blockThreshold?: number } = {}) {
    this.customPatterns = config.customPatterns ?? [];
    this.blockThreshold = config.blockThreshold ?? 0.7;
  }

  /**
   * Analyze exec command for exfiltration attempts.
   */
  analyzeExecCommand(command: string): ExfilRisk {
    const findings: ExfilFinding[] = [];
    let maxConfidence = 0;

    const allPatterns = [...EXEC_EXFIL_PATTERNS, ...this.customPatterns];

    for (const p of allPatterns) {
      const match = p.pattern.exec(command);
      if (match) {
        findings.push({
          type: p.name,
          confidence: p.confidence,
          category: p.category,
          matchedText: match[0].slice(0, 100),
        });
        if (p.confidence > maxConfidence) {
          maxConfidence = p.confidence;
        }
      }
    }

    return {
      allowed: maxConfidence < this.blockThreshold,
      score: maxConfidence,
      findings,
    };
  }

  /**
   * Analyze outbound message for credential leaks.
   */
  analyzeOutboundMessage(message: string): ExfilRisk {
    const findings: ExfilFinding[] = [];
    let maxConfidence = 0;

    for (const cred of CREDENTIAL_PATTERNS) {
      const match = cred.pattern.exec(message);
      if (match) {
        findings.push({
          type: cred.name,
          confidence: 0.95, // Credential in message = very high confidence
          category: "credential_leak",
          matchedText: `${match[0].slice(0, 10)}...${match[0].slice(-4)}`, // Redact middle
        });
        maxConfidence = 0.95;
      }
    }

    // Check for large encoded payloads (possible encoded exfiltration)
    const base64Chunks = message.match(/[A-Za-z0-9+/]{200,}={0,2}/g);
    if (base64Chunks && base64Chunks.length > 0) {
      findings.push({
        type: "large_encoded_payload",
        confidence: 0.6,
        category: "encoded_exfil",
      });
      if (0.6 > maxConfidence) maxConfidence = 0.6;
    }

    return {
      allowed: maxConfidence < this.blockThreshold,
      score: maxConfidence,
      findings,
    };
  }

  /**
   * Analyze a URL for exfiltration indicators.
   */
  analyzeUrl(url: string): ExfilRisk {
    const findings: ExfilFinding[] = [];
    let score = 0;

    // Check for data in URL parameters
    try {
      const parsed = new URL(url);
      const params = parsed.searchParams;

      for (const [key, value] of params) {
        // Long values in URL params = suspicious
        if (value.length > 500) {
          findings.push({
            type: "large_url_param",
            confidence: 0.6,
            category: "url_exfil",
            matchedText: `${key}=${value.slice(0, 20)}...`,
          });
          score = Math.max(score, 0.6);
        }

        // Base64 in URL params
        if (/^[A-Za-z0-9+/]{50,}={0,2}$/.test(value)) {
          findings.push({
            type: "base64_url_param",
            confidence: 0.7,
            category: "encoded_exfil",
            matchedText: `${key}=base64(${value.length} chars)`,
          });
          score = Math.max(score, 0.7);
        }
      }
    } catch {
      // Invalid URL
    }

    return { allowed: score < this.blockThreshold, score, findings };
  }
}
