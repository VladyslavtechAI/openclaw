/**
 * Multi-layer prompt injection defense system.
 * Protects against direct, indirect, encoded, and agent-to-agent injection.
 */

import type { InjectionPattern } from "./injection-patterns.js";
import { INJECTION_PATTERNS } from "./injection-patterns.js";

export type ContentContext = {
  /** Where the content came from */
  source: "user" | "external" | "agent" | "tool_output" | "skill";
  /** Specific tool/channel type */
  type?: "web_fetch" | "pdf" | "email" | "message" | "exec_output" | "sessions_send";
  /** Agent that produced the content (for agent-to-agent) */
  sourceAgentId?: string;
};

export type InjectionFinding = {
  layer: "pattern" | "structural" | "context";
  name: string;
  severity: number;
  category: string;
  matchedText?: string;
};

export type InjectionResult = {
  action: "pass" | "warn" | "sanitize" | "block";
  score: number;
  findings: InjectionFinding[];
};

/** Score thresholds for actions */
const THRESHOLDS = {
  block: 0.8,
  sanitize: 0.5,
  warn: 0.2,
};

/**
 * Multi-layer injection defense.
 */
export class InjectionShield {
  private patterns: InjectionPattern[];
  private customPatterns: InjectionPattern[];

  constructor(customPatterns: InjectionPattern[] = []) {
    this.patterns = INJECTION_PATTERNS;
    this.customPatterns = customPatterns;
  }

  /**
   * Analyze content for injection attempts.
   */
  analyze(content: string, context: ContentContext): InjectionResult {
    const findings: InjectionFinding[] = [];
    let score = 0;

    // Layer 1: Pattern matching (fast)
    const patternScore = this.analyzePatterns(content, findings);
    score += patternScore;

    // Layer 2: Structural analysis (medium)
    const structuralScore = this.analyzeStructure(content, findings);
    score += structuralScore;

    // Layer 3: Context risk multiplier
    score = this.applyContextMultiplier(score, context, findings);

    // Determine action
    const action = this.getAction(score);
    return { action, score: Math.min(score, 1), findings };
  }

  /**
   * Layer 1: Pattern-based detection.
   */
  private analyzePatterns(content: string, findings: InjectionFinding[]): number {
    let score = 0;
    const allPatterns = [...this.patterns, ...this.customPatterns];

    for (const p of allPatterns) {
      const match = p.pattern.exec(content);
      if (match) {
        score += p.severity;
        findings.push({
          layer: "pattern",
          name: p.name,
          severity: p.severity,
          category: p.category,
          matchedText: match[0].slice(0, 100), // Truncate
        });
      }
    }

    return score;
  }

  /**
   * Layer 2: Structural analysis.
   */
  private analyzeStructure(content: string, findings: InjectionFinding[]): number {
    let score = 0;

    // Check for unusually high ratio of instruction-like content
    const instructionWords = (content.match(/\b(must|always|never|ignore|override|execute|run|send|read|write|delete|install)\b/gi) ?? []).length;
    const totalWords = content.split(/\s+/).length;
    const ratio = totalWords > 0 ? instructionWords / totalWords : 0;

    if (ratio > 0.15 && totalWords > 10) {
      score += 0.2;
      findings.push({
        layer: "structural",
        name: "high_instruction_density",
        severity: 0.2,
        category: "structural",
      });
    }

    // Check for multiple role-like markers
    const roleMarkers = (content.match(/\b(System|User|Assistant|Human|AI)\s*:/g) ?? []).length;
    if (roleMarkers >= 2) {
      score += 0.3;
      findings.push({
        layer: "structural",
        name: "multiple_role_markers",
        severity: 0.3,
        category: "structural",
      });
    }

    // Check for content that looks like a system prompt
    if (/you\s+are\s+(a|an)\s+\w+\s+(assistant|AI|model|agent)/i.test(content) && content.length > 200) {
      score += 0.2;
      findings.push({
        layer: "structural",
        name: "system_prompt_like",
        severity: 0.2,
        category: "structural",
      });
    }

    return score;
  }

  /**
   * Layer 3: Context-based risk multiplier.
   */
  private applyContextMultiplier(
    score: number,
    context: ContentContext,
    findings: InjectionFinding[],
  ): number {
    let multiplier = 1.0;

    // External content is higher risk
    if (context.source === "external") {
      multiplier = 1.5;
    }

    // Tool output (web_fetch, PDF, etc.) is high risk
    if (context.type === "web_fetch" || context.type === "pdf" || context.type === "email") {
      multiplier = 1.8;
    }

    // Agent-to-agent: medium risk (could be tainted)
    if (context.source === "agent") {
      multiplier = 1.3;
    }

    // Skill content: high risk (supply chain)
    if (context.source === "skill") {
      multiplier = 1.6;
    }

    if (multiplier > 1.0 && score > 0) {
      findings.push({
        layer: "context",
        name: `risk_multiplier_${context.source}`,
        severity: multiplier - 1,
        category: "context",
      });
    }

    return score * multiplier;
  }

  /**
   * Determine action based on score.
   */
  private getAction(score: number): InjectionResult["action"] {
    if (score >= THRESHOLDS.block) return "block";
    if (score >= THRESHOLDS.sanitize) return "sanitize";
    if (score >= THRESHOLDS.warn) return "warn";
    return "pass";
  }

  /**
   * Sanitize content by removing detected injection patterns.
   */
  sanitize(content: string): string {
    let sanitized = content;

    // Remove role markers
    sanitized = sanitized.replace(/<\|im_start\|>system[\s\S]*?<\|im_end\|>/gi, "[REMOVED]");
    sanitized = sanitized.replace(/\[SYSTEM\][\s\S]*?\[\/SYSTEM\]/gi, "[REMOVED]");
    sanitized = sanitized.replace(/\[INST\][\s\S]*?\[\/INST\]/gi, "[REMOVED]");

    // Remove HTML comments with hidden instructions
    sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, "");

    // Remove zero-width characters
    sanitized = sanitized.replace(/[\u200B\u200C\u200D\uFEFF]/gu, "");

    // Remove RTL/LTR override characters
    sanitized = sanitized.replace(/[\u200F\u200E\u202A-\u202E\u2066-\u2069]/gu, "");

    return sanitized;
  }
}
