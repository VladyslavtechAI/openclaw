/**
 * Backdoor and persistence detection for workspace and config files.
 * Includes file integrity monitoring (hash-chain based).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BackdoorPattern } from "./injection-patterns.js";
import { BACKDOOR_PATTERNS } from "./injection-patterns.js";

export type IntegrityViolation = {
  path: string;
  type: "modified" | "deleted" | "new_file";
  expectedHash?: string;
  currentHash?: string;
  severity: "critical" | "high" | "medium" | "low";
};

export type BackdoorFinding = {
  file: string;
  pattern: string;
  severity: "critical" | "high" | "medium" | "low";
  matchedText: string;
  line: number;
};

export type ScanResult = {
  clean: boolean;
  integrityViolations: IntegrityViolation[];
  backdoorFindings: BackdoorFinding[];
  scannedFiles: number;
  timestamp: number;
};

/**
 * Compute SHA-256 hash of file content.
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * File integrity monitor + backdoor scanner.
 */
export class BackdoorScanner {
  private baseline: Map<string, string> = new Map();
  private customPatterns: BackdoorPattern[];

  constructor(customPatterns: BackdoorPattern[] = []) {
    this.customPatterns = customPatterns;
  }

  /**
   * Initialize baseline hashes for critical files.
   */
  initBaseline(filePaths: string[]): void {
    this.baseline.clear();
    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        this.baseline.set(filePath, hashContent(content));
      } catch {
        // File doesn't exist yet — that's ok
      }
    }
  }

  /**
   * Set baseline from a known-good state (e.g., loaded from disk).
   */
  setBaseline(baseline: Map<string, string>): void {
    this.baseline = new Map(baseline);
  }

  /**
   * Get current baseline for persistence.
   */
  getBaseline(): Map<string, string> {
    return new Map(this.baseline);
  }

  /**
   * Check file integrity against baseline.
   */
  checkIntegrity(): IntegrityViolation[] {
    const violations: IntegrityViolation[] = [];

    for (const [filePath, expectedHash] of this.baseline) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const currentHash = hashContent(content);
        if (currentHash !== expectedHash) {
          violations.push({
            path: filePath,
            type: "modified",
            expectedHash,
            currentHash,
            severity: this.getFileSeverity(filePath),
          });
        }
      } catch {
        violations.push({
          path: filePath,
          type: "deleted",
          expectedHash,
          severity: this.getFileSeverity(filePath),
        });
      }
    }

    return violations;
  }

  /**
   * Scan content for backdoor patterns.
   */
  scanContent(content: string, filePath: string): BackdoorFinding[] {
    const findings: BackdoorFinding[] = [];
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);
    const allPatterns = [...BACKDOOR_PATTERNS, ...this.customPatterns];

    const lines = content.split("\n");

    for (const pattern of allPatterns) {
      // Check if this pattern applies to this file type
      const matchesFileType = pattern.fileTypes.some(
        (ft) => ext === ft || basename === ft || filePath.endsWith(ft),
      );
      if (!matchesFileType) continue;

      for (let i = 0; i < lines.length; i++) {
        const match = pattern.pattern.exec(lines[i]);
        if (match) {
          findings.push({
            file: filePath,
            pattern: pattern.name,
            severity: pattern.severity,
            matchedText: match[0].slice(0, 200),
            line: i + 1,
          });
        }
      }
    }

    return findings;
  }

  /**
   * Full scan: integrity check + backdoor pattern scan.
   */
  fullScan(filePaths: string[]): ScanResult {
    const integrityViolations = this.checkIntegrity();
    const backdoorFindings: BackdoorFinding[] = [];
    let scannedFiles = 0;

    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const findings = this.scanContent(content, filePath);
        backdoorFindings.push(...findings);
        scannedFiles++;
      } catch {
        // Skip unreadable files
      }
    }

    return {
      clean: integrityViolations.length === 0 && backdoorFindings.length === 0,
      integrityViolations,
      backdoorFindings,
      scannedFiles,
      timestamp: Date.now(),
    };
  }

  /**
   * Determine severity based on file path.
   */
  private getFileSeverity(filePath: string): IntegrityViolation["severity"] {
    const lower = filePath.toLowerCase();
    if (lower.includes("openclaw.json")) return "critical";
    if (lower.includes("auth-profiles")) return "critical";
    if (lower.includes("authorized_keys")) return "critical";
    if (lower.includes(".ssh/")) return "critical";
    if (lower.includes("soul.md") || lower.includes("agents.md")) return "high";
    if (lower.includes("cron")) return "high";
    if (lower.includes("skill.md")) return "medium";
    return "low";
  }
}
