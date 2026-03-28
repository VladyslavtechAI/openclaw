// ─── ANSI Color Codes ───────────────────────────────────────────────────────

const ANSI_RESET = "\x1b[0m";

const ANSI_COLORS: Record<Color, string> = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

type Color = "red" | "green" | "yellow" | "blue" | "gray";
type StatusLevel = "ok" | "warn" | "error" | "disabled";

// ─── Colorize ───────────────────────────────────────────────────────────────

/**
 * Wraps `text` in ANSI escape codes for the given color.
 * If stdout is not a TTY, returns the text unmodified.
 */
export function colorize(text: string, color: Color): string {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `${ANSI_COLORS[color]}${text}${ANSI_RESET}`;
}

// ─── Format Table ───────────────────────────────────────────────────────────

/**
 * Renders a simple ASCII table from column headers and row data.
 *
 * Example output:
 * ```
 *  Module          | Status   | Message
 * -----------------+----------+---------
 *  InjectionShield | healthy  | OK
 *  DlpEngine       | degraded | Slow
 * ```
 */
export function formatTable(headers: string[], rows: string[][]): string {
  const columnCount = headers.length;

  // Calculate the max width for each column (accounting for headers and data)
  const widths: number[] = [];
  for (let col = 0; col < columnCount; col++) {
    let max = headers[col]?.length ?? 0;
    for (const row of rows) {
      const cell = row[col] ?? "";
      // Strip ANSI codes when measuring width
      const stripped = cell.replace(/\x1b\[\d+m/g, "");
      if (stripped.length > max) {
        max = stripped.length;
      }
    }
    widths.push(max);
  }

  // Build header line
  const headerLine = headers
    .map((h, i) => ` ${h.padEnd(widths[i] ?? 0)} `)
    .join("|");

  // Build separator line
  const separatorLine = widths
    .map((w) => "-".repeat(w + 2))
    .join("+");

  // Build data lines
  const dataLines = rows.map((row) =>
    row
      .map((cell, i) => {
        const stripped = cell.replace(/\x1b\[\d+m/g, "");
        const padding = (widths[i] ?? 0) - stripped.length;
        return ` ${cell}${" ".repeat(Math.max(0, padding))} `;
      })
      .join("|"),
  );

  return [headerLine, separatorLine, ...dataLines].join("\n");
}

// ─── Format Status ──────────────────────────────────────────────────────────

const STATUS_SYMBOLS: Record<StatusLevel, { symbol: string; color: Color }> = {
  ok: { symbol: "[OK]", color: "green" },
  warn: { symbol: "[WARN]", color: "yellow" },
  error: { symbol: "[ERR]", color: "red" },
  disabled: { symbol: "[OFF]", color: "gray" },
};

/**
 * Formats a labeled status indicator with color-coded symbol.
 *
 * Example: `formatStatus("DLP Engine", "ok")` => "  [OK]  DLP Engine"
 */
export function formatStatus(label: string, status: StatusLevel): string {
  const { symbol, color } = STATUS_SYMBOLS[status];
  return `  ${colorize(symbol, color)}  ${label}`;
}

// ─── Format Bytes ───────────────────────────────────────────────────────────

const BYTE_UNITS: ReadonlyArray<{ threshold: number; unit: string; divisor: number }> = [
  { threshold: 1_073_741_824, unit: "GB", divisor: 1_073_741_824 },
  { threshold: 1_048_576, unit: "MB", divisor: 1_048_576 },
  { threshold: 1_024, unit: "KB", divisor: 1_024 },
];

/**
 * Formats a byte count into a human-readable string.
 *
 * Examples:
 *   - `formatBytes(512)`       => "512 B"
 *   - `formatBytes(1536)`      => "1.50 KB"
 *   - `formatBytes(2621440)`   => "2.50 MB"
 */
export function formatBytes(bytes: number): string {
  for (const { threshold, unit, divisor } of BYTE_UNITS) {
    if (bytes >= threshold) {
      return `${(bytes / divisor).toFixed(2)} ${unit}`;
    }
  }
  return `${bytes} B`;
}

// ─── Format Duration ────────────────────────────────────────────────────────

/**
 * Formats a millisecond duration into a human-readable string.
 *
 * Examples:
 *   - `formatDuration(45)`       => "45ms"
 *   - `formatDuration(5000)`     => "5s"
 *   - `formatDuration(125000)`   => "2m 5s"
 *   - `formatDuration(5000000)`  => "1h 23m"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 && hours === 0) {
    // Only show seconds when under an hour
    parts.push(`${seconds}s`);
  }

  return parts.join(" ") || "0s";
}

// ─── Format Currency ────────────────────────────────────────────────────────

/**
 * Formats a USD amount with commas and two decimal places.
 *
 * Examples:
 *   - `formatCurrency(0.5)`     => "$0.50"
 *   - `formatCurrency(1234.5)`  => "$1,234.50"
 *   - `formatCurrency(1000000)` => "$1,000,000.00"
 */
export function formatCurrency(usd: number): string {
  const fixed = usd.toFixed(2);
  const [intPart, decPart] = fixed.split(".");

  // Add commas to the integer part
  const withCommas = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `$${withCommas}.${decPart ?? "00"}`;
}
