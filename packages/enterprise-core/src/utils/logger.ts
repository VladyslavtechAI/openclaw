export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private readonly module: string;
  private readonly minLevel: LogLevel;
  private readonly sink: (entry: LogEntry) => void;

  constructor(
    module: string,
    options?: {
      level?: LogLevel;
      sink?: (entry: LogEntry) => void;
    },
  ) {
    this.module = module;
    this.minLevel = options?.level ?? "info";
    this.sink =
      options?.sink ??
      ((entry) => {
        const stream =
          entry.level === "error" || entry.level === "warn"
            ? process.stderr
            : process.stdout;
        stream.write(JSON.stringify(entry) + "\n");
      });
  }

  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`, {
      level: this.minLevel,
      sink: this.sink,
    });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
    };
    if (data !== undefined) entry.data = data;
    this.sink(entry);
  }
}
