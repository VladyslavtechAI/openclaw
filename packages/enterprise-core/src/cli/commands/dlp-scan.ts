import { createReadStream, readdirSync, statSync, type Dirent } from "node:fs";
import { createInterface } from "node:readline";
import { join, relative } from "node:path";
import { colorize } from "../formatters.js";

export const description = "Scan a workspace directory for PII and sensitive data patterns";

// ─── PII Pattern Definitions ────────────────────────────────────────────────

interface PiiPattern {
  name: string;
  regex: RegExp;
}

const PII_PATTERNS: readonly PiiPattern[] = [
  {
    name: "Email",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    name: "Phone (US)",
    regex: /(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    name: "SSN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    name: "Credit Card",
    regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
  },
  {
    name: "API Key",
    regex: /(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/gi,
  },
  {
    name: "AWS Key",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: "Private Key",
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  },
];

// ─── File Discovery ─────────────────────────────────────────────────────────

/** File extensions to scan. Binary and media files are excluded. */
const SCANNABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt", ".csv",
  ".env", ".cfg", ".conf", ".ini",
  ".py", ".rb", ".go", ".rs", ".java",
  ".html", ".css", ".xml", ".sql",
  ".sh", ".bash", ".zsh",
]);

/** Directories to always skip */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "vendor", "coverage", ".turbo",
]);

function collectFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: "utf-8" });
    } catch {
      // Permission denied or other read error; silently skip
      return;
    }

    for (const entry of entries) {
      const name: string = entry.name as string;
      const fullPath = join(current, name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = name.slice(name.lastIndexOf("."));
        // Scan files with known text extensions, or extensionless dotfiles like .env
        if (SCANNABLE_EXTENSIONS.has(ext) || name.startsWith(".env")) {
          // Skip very large files (> 5 MB)
          try {
            const stat = statSync(fullPath);
            if (stat.size <= 5_242_880) {
              files.push(fullPath);
            }
          } catch {
            // stat failed; skip
          }
        }
      }
    }
  }

  walk(dir);
  return files;
}

// ─── File Scanning ──────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  pattern: string;
  match: string;
}

async function scanFile(filePath: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;

    for (const pattern of PII_PATTERNS) {
      // Reset the regex lastIndex for each line since they use the global flag
      pattern.regex.lastIndex = 0;
      let result = pattern.regex.exec(line);
      while (result !== null) {
        const matchText = result[0];
        // Truncate long matches for readability
        const displayMatch =
          matchText.length > 60
            ? matchText.slice(0, 57) + "..."
            : matchText;

        findings.push({
          file: filePath,
          line: lineNumber,
          pattern: pattern.name,
          match: displayMatch,
        });

        result = pattern.regex.exec(line);
      }
    }
  }

  return findings;
}

// ─── Command Runner ─────────────────────────────────────────────────────────

export interface DlpScanArgs {
  /** Absolute path to the workspace directory to scan */
  workspacePath: string;
}

/**
 * Scans all text files in the given workspace directory for PII patterns
 * (email addresses, phone numbers, SSNs, credit card numbers, API keys).
 *
 * Reports each finding with file path, line number, pattern type, and matched text.
 */
export async function run(args: DlpScanArgs): Promise<string> {
  const { workspacePath } = args;

  // Validate the path exists and is a directory
  let dirStat: ReturnType<typeof statSync>;
  try {
    dirStat = statSync(workspacePath);
  } catch {
    return `${colorize("Error:", "red")} Path does not exist: ${workspacePath}\n`;
  }
  if (!dirStat.isDirectory()) {
    return `${colorize("Error:", "red")} Path is not a directory: ${workspacePath}\n`;
  }

  const lines: string[] = [];

  lines.push("");
  lines.push(colorize("=== DLP Workspace Scan ===", "blue"));
  lines.push(`  Scanning: ${workspacePath}`);
  lines.push("");

  // Collect files
  const files = collectFiles(workspacePath);
  lines.push(`  Files to scan: ${files.length}`);
  lines.push("");

  if (files.length === 0) {
    lines.push(colorize("  No scannable files found.", "gray"));
    lines.push("");
    return lines.join("\n");
  }

  // Scan all files
  const allFindings: Finding[] = [];
  const filesWithFindings = new Set<string>();

  for (const file of files) {
    const findings = await scanFile(file);
    if (findings.length > 0) {
      allFindings.push(...findings);
      filesWithFindings.add(file);
    }
  }

  if (allFindings.length === 0) {
    lines.push(`  ${colorize("No PII or sensitive data detected.", "green")}`);
    lines.push("");
    return lines.join("\n");
  }

  // Group findings by file
  const byFile = new Map<string, Finding[]>();
  for (const finding of allFindings) {
    const existing = byFile.get(finding.file);
    if (existing) {
      existing.push(finding);
    } else {
      byFile.set(finding.file, [finding]);
    }
  }

  // Render findings
  for (const [filePath, findings] of byFile) {
    const relPath = relative(workspacePath, filePath);
    lines.push(`  ${colorize(relPath, "yellow")}`);
    for (const f of findings) {
      lines.push(
        `    L${String(f.line).padStart(4)}  ${colorize(`[${f.pattern}]`, "red")}  ${f.match}`,
      );
    }
    lines.push("");
  }

  // Summary
  lines.push(`  ${"─".repeat(55)}`);
  lines.push(
    `  ${colorize("Findings:", "red")} ${allFindings.length} match(es) ` +
    `across ${filesWithFindings.size} file(s)`,
  );

  // Break down by pattern type
  const byCategoryCount = new Map<string, number>();
  for (const f of allFindings) {
    byCategoryCount.set(f.pattern, (byCategoryCount.get(f.pattern) ?? 0) + 1);
  }
  const categories = Array.from(byCategoryCount.entries())
    .sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of categories) {
    lines.push(`    ${pattern}: ${count}`);
  }

  lines.push("");
  return lines.join("\n");
}
