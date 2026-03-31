/**
 * Metrics collection and aggregation for observability.
 * Stores metric points in daily JSONL files and provides time-series queries.
 */

import fs from "node:fs";
import path from "node:path";

export type MetricPoint = {
  timestamp: string;
  name: string;
  value: number;
  agentId?: string;
  machine?: string;
  tags?: Record<string, string>;
};

export type StoredMetricPoint = MetricPoint & {
  /** Epoch ms for fast range comparisons. */
  ts: number;
};

export type TimeRange = {
  start: string;
  end: string;
};

export type TimeSeries = {
  name: string;
  points: Array<{ timestamp: string; value: number }>;
};

export type MetricsSummary = {
  period: TimeRange;
  totalPoints: number;
  metrics: Record<
    string,
    {
      count: number;
      sum: number;
      min: number;
      max: number;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
    }
  >;
};

export type AgentMetric = {
  agentId: string;
  value: number;
  count: number;
};

export type MetricsCollectorConfig = {
  /** Directory for metric data files. */
  dataDir: string;
  /** Days to retain metric files (default: 30). */
  retentionDays?: number;
};

/**
 * Collects, stores, and aggregates metric data points.
 */
export class MetricsCollector {
  private dataDir: string;
  private retentionDays: number;

  constructor(config: MetricsCollectorConfig) {
    this.dataDir = config.dataDir;
    this.retentionDays = config.retentionDays ?? 30;
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.cleanOldFiles();
  }

  /**
   * Record a single metric data point.
   */
  record(metric: MetricPoint): void {
    const stored: StoredMetricPoint = {
      ...metric,
      ts: new Date(metric.timestamp).getTime(),
    };

    try {
      const filePath = this.getFilePath(new Date(metric.timestamp));
      fs.appendFileSync(filePath, JSON.stringify(stored) + "\n");
    } catch {
      // Never crash on metric write failure
    }
  }

  /**
   * Get a time series for a named metric, bucketed by resolution.
   * Resolution examples: "1m", "5m", "1h", "1d".
   */
  getTimeSeries(name: string, range: TimeRange, resolution: string): TimeSeries {
    const points = this.queryPoints(name, range);
    const bucketMs = parseResolution(resolution);

    if (bucketMs === 0 || points.length === 0) {
      return { name, points: [] };
    }

    // Bucket points by resolution
    const buckets = new Map<number, number[]>();
    for (const p of points) {
      const bucketKey = Math.floor(p.ts / bucketMs) * bucketMs;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = [];
        buckets.set(bucketKey, bucket);
      }
      bucket.push(p.value);
    }

    // Average each bucket
    const result: Array<{ timestamp: string; value: number }> = [];
    const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
    for (const key of sortedKeys) {
      const values = buckets.get(key)!;
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      result.push({ timestamp: new Date(key).toISOString(), value: Math.round(avg * 1000) / 1000 });
    }

    return { name, points: result };
  }

  /**
   * Get a summary of all metrics within a time range.
   */
  getSummary(range: TimeRange): MetricsSummary {
    const allPoints = this.queryAllPoints(range);
    const grouped = new Map<string, number[]>();

    for (const p of allPoints) {
      let values = grouped.get(p.name);
      if (!values) {
        values = [];
        grouped.set(p.name, values);
      }
      values.push(p.value);
    }

    const metrics: MetricsSummary["metrics"] = {};
    for (const [name, values] of grouped) {
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((s, v) => s + v, 0);
      metrics[name] = {
        count: sorted.length,
        sum: round(sum),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: round(sum / sorted.length),
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      };
    }

    return {
      period: range,
      totalPoints: allPoints.length,
      metrics,
    };
  }

  /**
   * Get top agents by a metric, ranked by total value.
   */
  getTopAgents(metricName: string, range: TimeRange, limit: number): AgentMetric[] {
    const points = this.queryPoints(metricName, range);
    const byAgent = new Map<string, { value: number; count: number }>();

    for (const p of points) {
      if (!p.agentId) continue;
      const existing = byAgent.get(p.agentId) ?? { value: 0, count: 0 };
      existing.value += p.value;
      existing.count++;
      byAgent.set(p.agentId, existing);
    }

    return [...byAgent.entries()]
      .map(([agentId, { value, count }]) => ({ agentId, value: round(value), count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  private queryPoints(name: string, range: TimeRange): StoredMetricPoint[] {
    return this.queryAllPoints(range).filter((p) => p.name === name);
  }

  private queryAllPoints(range: TimeRange): StoredMetricPoint[] {
    const startTs = new Date(range.start).getTime();
    const endTs = new Date(range.end).getTime();
    const dates = this.getDateRange(range.start, range.end);
    const results: StoredMetricPoint[] = [];

    for (const date of dates) {
      const records = this.readDailyRecords(date);
      for (const record of records) {
        if (record.ts >= startTs && record.ts <= endTs) {
          results.push(record);
        }
      }
    }

    return results;
  }

  private readDailyRecords(date: Date): StoredMetricPoint[] {
    const filePath = this.getFilePath(date);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      return fs
        .readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StoredMetricPoint);
    } catch {
      return [];
    }
  }

  private getDateRange(since: string, until: string): Date[] {
    const start = new Date(since);
    const end = new Date(until);
    const dates: Date[] = [];
    const current = new Date(start.toISOString().slice(0, 10));

    while (current <= end) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  private getFilePath(date: Date): string {
    return path.join(this.dataDir, `metrics-${date.toISOString().slice(0, 10)}.jsonl`);
  }

  private cleanOldFiles(): void {
    try {
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.dataDir).filter((f) => f.startsWith("metrics-") && f.endsWith(".jsonl"));

      for (const file of files) {
        const dateStr = file.replace("metrics-", "").replace(".jsonl", "");
        const fileDate = new Date(dateStr);
        if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoff) {
          fs.unlinkSync(path.join(this.dataDir, file));
        }
      }
    } catch {
      // Non-critical cleanup
    }
  }
}

/** Parse resolution string ("1m", "5m", "1h", "1d") to milliseconds. */
function parseResolution(resolution: string): number {
  const match = resolution.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60_000; // default 1 minute

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    case "d":
      return value * 86_400_000;
    default:
      return 60_000;
  }
}

/** Calculate percentile from a sorted array. */
function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/** Round to 3 decimal places. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
