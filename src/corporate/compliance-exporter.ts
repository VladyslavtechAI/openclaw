/**
 * Corporate Compliance Exporter
 * SOC 2 evidence generation, HIPAA audit log export, configurable compliance frameworks.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type ComplianceFramework = "soc2" | "hipaa" | "gdpr" | "iso27001" | "pci-dss";

export interface AuditLog {
  timestamp: number;
  actor: string; // Agent ID or user ID
  action: string;
  resource?: string;
  status: "success" | "failure";
  details?: Record<string, unknown>;
  ipAddress?: string;
  sessionId?: string;
}

export interface ComplianceControl {
  id: string;
  framework: ComplianceFramework;
  title: string;
  description: string;
  category: string;
  evidenceQuery: EvidenceQuery;
}

export interface EvidenceQuery {
  type: "audit_log" | "config_snapshot" | "access_review" | "custom";
  filters?: Record<string, unknown>;
  aggregation?: "count" | "list" | "summary";
}

export interface EvidencePackage {
  id: string;
  framework: ComplianceFramework;
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  controls: string[]; // Control IDs
  evidence: Record<string, unknown>; // Control ID -> evidence data
  attestation?: string; // Digital signature or attestation
}

export interface ComplianceExporterConfig {
  storageDir: string;
  auditLogDir?: string; // Directory containing audit logs
  frameworks?: ComplianceFramework[];
}

export class ComplianceExporter {
  private readonly storageDir: string;
  private readonly auditLogDir: string;
  private readonly evidenceDir: string;
  private readonly controlsFile: string;
  private readonly frameworks: ComplianceFramework[];
  private controls: Map<string, ComplianceControl> = new Map();
  private auditLogs: AuditLog[] = [];

  constructor(config: ComplianceExporterConfig) {
    this.storageDir = config.storageDir;
    this.auditLogDir = config.auditLogDir ?? path.join(this.storageDir, "audit-logs");
    this.evidenceDir = path.join(this.storageDir, "evidence");
    this.controlsFile = path.join(this.storageDir, "compliance-controls.json");
    this.frameworks = config.frameworks ?? ["soc2", "hipaa"];

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (!fs.existsSync(this.auditLogDir)) {
      fs.mkdirSync(this.auditLogDir, { recursive: true });
    }

    if (!fs.existsSync(this.evidenceDir)) {
      fs.mkdirSync(this.evidenceDir, { recursive: true });
    }

    this.loadControls();
    this.loadDefaultControls();
    this.loadAuditLogs();
  }

  private loadControls(): void {
    if (fs.existsSync(this.controlsFile)) {
      const data = JSON.parse(fs.readFileSync(this.controlsFile, "utf8"));
      this.controls = new Map(Object.entries(data));
    }
  }

  private saveControls(): void {
    const data = Object.fromEntries(this.controls);
    fs.writeFileSync(this.controlsFile, JSON.stringify(data, null, 2), "utf8");
  }

  private loadAuditLogs(): void {
    // Load all JSONL audit logs
    const files = fs.readdirSync(this.auditLogDir).filter((f) => f.endsWith(".jsonl"));

    for (const file of files) {
      const filePath = path.join(this.auditLogDir, file);
      const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");

      for (const line of lines) {
        if (line.trim()) {
          this.auditLogs.push(JSON.parse(line));
        }
      }
    }
  }

  private loadDefaultControls(): void {
    // SOC 2 Type II controls
    if (this.frameworks.includes("soc2")) {
      this.controls.set("CC6.1", {
        id: "CC6.1",
        framework: "soc2",
        title: "Logical and Physical Access Controls",
        description: "Access to systems and data is restricted to authorized users",
        category: "Access Control",
        evidenceQuery: {
          type: "audit_log",
          filters: { action: "login" },
          aggregation: "count",
        },
      });

      this.controls.set("CC7.2", {
        id: "CC7.2",
        framework: "soc2",
        title: "System Monitoring",
        description: "System activities are monitored and logged",
        category: "System Operations",
        evidenceQuery: {
          type: "audit_log",
          aggregation: "count",
        },
      });
    }

    // HIPAA controls
    if (this.frameworks.includes("hipaa")) {
      this.controls.set("164.308", {
        id: "164.308",
        framework: "hipaa",
        title: "Administrative Safeguards",
        description: "Security management process and workforce security",
        category: "Administrative",
        evidenceQuery: {
          type: "access_review",
          aggregation: "summary",
        },
      });

      this.controls.set("164.312", {
        id: "164.312",
        framework: "hipaa",
        title: "Technical Safeguards",
        description: "Access control, audit controls, and transmission security",
        category: "Technical",
        evidenceQuery: {
          type: "audit_log",
          filters: { action: "access_phi" },
          aggregation: "list",
        },
      });
    }

    this.saveControls();
  }

  /**
   * Log an audit event.
   */
  logAudit(log: Omit<AuditLog, "timestamp">): void {
    const entry: AuditLog = {
      ...log,
      timestamp: Date.now(),
    };

    this.auditLogs.push(entry);

    // Append to daily JSONL file
    const date = new Date().toISOString().split("T")[0];
    const logFile = path.join(this.auditLogDir, `audit-${date}.jsonl`);

    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf8");
  }

  /**
   * Register a custom compliance control.
   */
  registerControl(control: ComplianceControl): void {
    this.controls.set(control.id, control);
    this.saveControls();
  }

  /**
   * Generate evidence for a compliance control.
   */
  private generateEvidence(
    control: ComplianceControl,
    startTime: number,
    endTime: number,
  ): unknown {
    const query = control.evidenceQuery;

    if (query.type === "audit_log") {
      // Filter logs by time range
      let logs = this.auditLogs.filter(
        (log) => log.timestamp >= startTime && log.timestamp <= endTime,
      );

      // Apply additional filters
      if (query.filters) {
        for (const [key, value] of Object.entries(query.filters)) {
          logs = logs.filter((log) => log[key as keyof AuditLog] === value);
        }
      }

      // Apply aggregation
      switch (query.aggregation) {
        case "count":
          return { count: logs.length };
        case "list":
          return { logs: logs.slice(0, 100) }; // Limit to 100 entries
        case "summary":
          return {
            count: logs.length,
            uniqueActors: new Set(logs.map((l) => l.actor)).size,
            successRate:
              logs.filter((l) => l.status === "success").length / logs.length,
          };
        default:
          return { logs };
      }
    }

    if (query.type === "access_review") {
      // Generate access review summary
      const logs = this.auditLogs.filter(
        (log) =>
          log.timestamp >= startTime &&
          log.timestamp <= endTime &&
          log.action.includes("access"),
      );

      return {
        totalAccessEvents: logs.length,
        uniqueUsers: new Set(logs.map((l) => l.actor)).size,
        failedAccess: logs.filter((l) => l.status === "failure").length,
      };
    }

    return { message: "Evidence generation not implemented for this query type" };
  }

  /**
   * Generate a compliance evidence package.
   */
  generateEvidencePackage(
    framework: ComplianceFramework,
    startTime: number,
    endTime: number,
    controlIds?: string[],
  ): EvidencePackage {
    // Get controls for the framework
    const frameworkControls = Array.from(this.controls.values()).filter(
      (c) => c.framework === framework,
    );

    const selectedControls = controlIds
      ? frameworkControls.filter((c) => controlIds.includes(c.id))
      : frameworkControls;

    if (selectedControls.length === 0) {
      throw new Error(`No controls found for framework ${framework}`);
    }

    // Generate evidence for each control
    const evidence: Record<string, unknown> = {};
    for (const control of selectedControls) {
      evidence[control.id] = {
        control: {
          id: control.id,
          title: control.title,
          description: control.description,
        },
        data: this.generateEvidence(control, startTime, endTime),
      };
    }

    const pkg: EvidencePackage = {
      id: crypto.randomUUID(),
      framework,
      periodStart: startTime,
      periodEnd: endTime,
      generatedAt: Date.now(),
      controls: selectedControls.map((c) => c.id),
      evidence,
    };

    // Save to disk
    const filename = `evidence-${framework}-${pkg.id}.json`;
    const filepath = path.join(this.evidenceDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(pkg, null, 2), "utf8");

    return pkg;
  }

  /**
   * Export HIPAA audit logs for a time period.
   */
  exportHIPAALogs(startTime: number, endTime: number): string {
    const logs = this.auditLogs.filter(
      (log) => log.timestamp >= startTime && log.timestamp <= endTime,
    );

    let report = "HIPAA Audit Log Export\n";
    report += "======================\n\n";
    report += `Period: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;
    report += `Total Events: ${logs.length}\n\n`;

    report += "Detailed Logs:\n\n";

    for (const log of logs) {
      report += `[${new Date(log.timestamp).toISOString()}] `;
      report += `Actor: ${log.actor} | `;
      report += `Action: ${log.action} | `;
      report += `Status: ${log.status}`;
      if (log.resource) {
        report += ` | Resource: ${log.resource}`;
      }
      if (log.ipAddress) {
        report += ` | IP: ${log.ipAddress}`;
      }
      report += "\n";
    }

    // Save report
    const filename = `hipaa-export-${Date.now()}.txt`;
    const filepath = path.join(this.evidenceDir, filename);
    fs.writeFileSync(filepath, report, "utf8");

    return report;
  }

  /**
   * Export SOC 2 evidence summary.
   */
  exportSOC2Summary(startTime: number, endTime: number): string {
    const pkg = this.generateEvidencePackage("soc2", startTime, endTime);

    let report = "SOC 2 Type II Evidence Summary\n";
    report += "==============================\n\n";
    report += `Period: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += "Controls Assessed:\n\n";

    for (const controlId of pkg.controls) {
      const evidence = pkg.evidence[controlId] as {
        control: { title: string; description: string };
        data: unknown;
      };
      report += `${controlId}: ${evidence.control.title}\n`;
      report += `  ${evidence.control.description}\n`;
      report += `  Evidence: ${JSON.stringify(evidence.data)}\n\n`;
    }

    const filename = `soc2-summary-${Date.now()}.txt`;
    const filepath = path.join(this.evidenceDir, filename);
    fs.writeFileSync(filepath, report, "utf8");

    return report;
  }

  /**
   * Get all audit logs for a time period.
   */
  getAuditLogs(startTime?: number, endTime?: number): AuditLog[] {
    const start = startTime ?? 0;
    const end = endTime ?? Date.now();

    return this.auditLogs.filter(
      (log) => log.timestamp >= start && log.timestamp <= end,
    );
  }

  /**
   * Get audit logs for a specific actor.
   */
  getAuditLogsByActor(actor: string, startTime?: number, endTime?: number): AuditLog[] {
    return this.getAuditLogs(startTime, endTime).filter((log) => log.actor === actor);
  }

  /**
   * Get all compliance controls.
   */
  getControls(framework?: ComplianceFramework): ComplianceControl[] {
    const controls = Array.from(this.controls.values());
    if (framework) {
      return controls.filter((c) => c.framework === framework);
    }
    return controls;
  }

  /**
   * Get a specific control.
   */
  getControl(controlId: string): ComplianceControl | undefined {
    return this.controls.get(controlId);
  }

  /**
   * Get all generated evidence packages.
   */
  getEvidencePackages(): string[] {
    return fs.readdirSync(this.evidenceDir).filter((f) => f.startsWith("evidence-"));
  }

  /**
   * Read an evidence package.
   */
  readEvidencePackage(filename: string): EvidencePackage {
    const filepath = path.join(this.evidenceDir, filename);
    if (!fs.existsSync(filepath)) {
      throw new Error(`Evidence package ${filename} not found`);
    }

    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  }
}
