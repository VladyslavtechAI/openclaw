/**
 * Corporate Reporting Pipeline
 * Daily/weekly automated rollup from workers→leads→admin, configurable metrics, markdown report generation.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type ReportFrequency = "daily" | "weekly" | "monthly";

export interface MetricDefinition {
  name: string;
  description: string;
  aggregation: "sum" | "avg" | "count" | "max" | "min";
  unit?: string;
}

export interface AgentMetrics {
  agentId: string;
  timestamp: number;
  metrics: Record<string, number>;
}

export interface ReportConfig {
  frequency: ReportFrequency;
  metrics: MetricDefinition[];
  recipients: string[]; // Agent IDs to receive reports
  rollupPath: string[]; // Hierarchy path for rollup
  format: "markdown" | "json";
}

export interface GeneratedReport {
  id: string;
  frequency: ReportFrequency;
  startTime: number;
  endTime: number;
  generatedAt: number;
  rollupPath: string[];
  content: string; // Markdown or JSON
  metrics: Record<string, Record<string, number>>; // agentId -> metric -> value
}

export interface ReportingPipelineConfig {
  storageDir: string;
}

export class ReportingPipeline {
  private readonly storageDir: string;
  private readonly metricsFile: string;
  private readonly reportsDir: string;
  private readonly configFile: string;
  private metrics: AgentMetrics[] = [];
  private reportConfigs: Map<string, ReportConfig> = new Map();

  constructor(config: ReportingPipelineConfig) {
    this.storageDir = config.storageDir;
    this.metricsFile = path.join(this.storageDir, "metrics.jsonl");
    this.reportsDir = path.join(this.storageDir, "reports");
    this.configFile = path.join(this.storageDir, "report-configs.json");

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }

    this.load();
  }

  private load(): void {
    // Load metrics from JSONL
    if (fs.existsSync(this.metricsFile)) {
      const lines = fs.readFileSync(this.metricsFile, "utf8").trim().split("\n");
      this.metrics = lines
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    }

    // Load report configs
    if (fs.existsSync(this.configFile)) {
      const data = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      this.reportConfigs = new Map(Object.entries(data));
    }
  }

  private saveMetrics(): void {
    const lines = this.metrics.map((m) => JSON.stringify(m)).join("\n");
    fs.writeFileSync(this.metricsFile, lines + "\n", "utf8");
  }

  private saveConfigs(): void {
    const data = Object.fromEntries(this.reportConfigs);
    fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * Record metrics for an agent.
   */
  recordMetrics(agentId: string, metrics: Record<string, number>): void {
    const entry: AgentMetrics = {
      agentId,
      timestamp: Date.now(),
      metrics,
    };

    this.metrics.push(entry);
    this.saveMetrics();
  }

  /**
   * Register a report configuration.
   */
  registerReport(
    name: string,
    frequency: ReportFrequency,
    metrics: MetricDefinition[],
    recipients: string[],
    rollupPath: string[],
    format?: "markdown" | "json",
  ): ReportConfig {
    const config: ReportConfig = {
      frequency,
      metrics,
      recipients,
      rollupPath,
      format: format ?? "markdown",
    };

    this.reportConfigs.set(name, config);
    this.saveConfigs();
    return config;
  }

  /**
   * Generate a report for a given configuration.
   */
  generateReport(configName: string, startTime?: number, endTime?: number): GeneratedReport {
    const config = this.reportConfigs.get(configName);
    if (!config) {
      throw new Error(`Report config ${configName} not found`);
    }

    const now = Date.now();
    const end = endTime ?? now;
    const start = startTime ?? this.getStartTimeForFrequency(config.frequency, end);

    // Filter metrics by time range and agents in rollup path
    const relevantMetrics = this.metrics.filter(
      (m) =>
        m.timestamp >= start &&
        m.timestamp <= end &&
        config.rollupPath.includes(m.agentId),
    );

    // Aggregate metrics per agent
    const aggregated: Record<string, Record<string, number>> = {};

    for (const agentId of config.rollupPath) {
      aggregated[agentId] = {};

      const agentMetrics = relevantMetrics.filter((m) => m.agentId === agentId);

      for (const metricDef of config.metrics) {
        const values = agentMetrics
          .map((m) => m.metrics[metricDef.name])
          .filter((v) => v !== undefined);

        if (values.length === 0) {
          aggregated[agentId][metricDef.name] = 0;
          continue;
        }

        switch (metricDef.aggregation) {
          case "sum":
            aggregated[agentId][metricDef.name] = values.reduce((a, b) => a + b, 0);
            break;
          case "avg":
            aggregated[agentId][metricDef.name] =
              values.reduce((a, b) => a + b, 0) / values.length;
            break;
          case "count":
            aggregated[agentId][metricDef.name] = values.length;
            break;
          case "max":
            aggregated[agentId][metricDef.name] = Math.max(...values);
            break;
          case "min":
            aggregated[agentId][metricDef.name] = Math.min(...values);
            break;
        }
      }
    }

    // Generate report content
    const content =
      config.format === "markdown"
        ? this.generateMarkdownReport(config, aggregated, start, end)
        : JSON.stringify({ config, aggregated, start, end }, null, 2);

    const report: GeneratedReport = {
      id: `${configName}-${now}`,
      frequency: config.frequency,
      startTime: start,
      endTime: end,
      generatedAt: now,
      rollupPath: config.rollupPath,
      content,
      metrics: aggregated,
    };

    // Save report to disk
    const reportFile = path.join(this.reportsDir, `${report.id}.md`);
    fs.writeFileSync(reportFile, content, "utf8");

    return report;
  }

  private generateMarkdownReport(
    config: ReportConfig,
    aggregated: Record<string, Record<string, number>>,
    startTime: number,
    endTime: number,
  ): string {
    const startDate = new Date(startTime).toISOString();
    const endDate = new Date(endTime).toISOString();

    let md = `# ${config.frequency.charAt(0).toUpperCase() + config.frequency.slice(1)} Report\n\n`;
    md += `**Period:** ${startDate} to ${endDate}\n\n`;
    md += `**Generated:** ${new Date().toISOString()}\n\n`;

    md += "## Metrics Summary\n\n";

    for (const metricDef of config.metrics) {
      md += `### ${metricDef.name}\n\n`;
      md += `${metricDef.description}\n\n`;

      md += "| Agent | Value |\n";
      md += "|-------|-------|\n";

      for (const agentId of config.rollupPath) {
        const value = aggregated[agentId]?.[metricDef.name] ?? 0;
        const unit = metricDef.unit ? ` ${metricDef.unit}` : "";
        md += `| ${agentId} | ${value.toFixed(2)}${unit} |\n`;
      }

      md += "\n";
    }

    // Add rollup totals
    md += "## Rollup Totals\n\n";
    md += "| Metric | Total |\n";
    md += "|--------|-------|\n";

    for (const metricDef of config.metrics) {
      const total = config.rollupPath.reduce((sum, agentId) => {
        return sum + (aggregated[agentId]?.[metricDef.name] ?? 0);
      }, 0);

      const unit = metricDef.unit ? ` ${metricDef.unit}` : "";
      md += `| ${metricDef.name} | ${total.toFixed(2)}${unit} |\n`;
    }

    return md;
  }

  private getStartTimeForFrequency(frequency: ReportFrequency, endTime: number): number {
    const end = new Date(endTime);

    switch (frequency) {
      case "daily":
        return end.getTime() - 24 * 60 * 60 * 1000;
      case "weekly":
        return end.getTime() - 7 * 24 * 60 * 60 * 1000;
      case "monthly":
        return end.getTime() - 30 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Get all metrics for an agent within a time range.
   */
  getMetrics(
    agentId: string,
    startTime?: number,
    endTime?: number,
  ): AgentMetrics[] {
    const start = startTime ?? 0;
    const end = endTime ?? Date.now();

    return this.metrics.filter(
      (m) => m.agentId === agentId && m.timestamp >= start && m.timestamp <= end,
    );
  }

  /**
   * Get a report configuration.
   */
  getReportConfig(name: string): ReportConfig | undefined {
    return this.reportConfigs.get(name);
  }

  /**
   * Get all report configurations.
   */
  getAllReportConfigs(): Map<string, ReportConfig> {
    return new Map(this.reportConfigs);
  }

  /**
   * Delete old metrics before a timestamp.
   */
  cleanupOldMetrics(beforeTimestamp: number): number {
    const before = this.metrics.length;
    this.metrics = this.metrics.filter((m) => m.timestamp >= beforeTimestamp);
    const deleted = before - this.metrics.length;

    if (deleted > 0) {
      this.saveMetrics();
    }

    return deleted;
  }

  /**
   * Get all saved reports.
   */
  getSavedReports(): string[] {
    return fs.readdirSync(this.reportsDir).filter((f) => f.endsWith(".md"));
  }

  /**
   * Read a saved report.
   */
  readReport(reportId: string): string {
    const reportFile = path.join(this.reportsDir, `${reportId}.md`);
    if (!fs.existsSync(reportFile)) {
      throw new Error(`Report ${reportId} not found`);
    }

    return fs.readFileSync(reportFile, "utf8");
  }
}
