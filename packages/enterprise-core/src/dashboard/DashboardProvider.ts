import type { EventBus } from "../events/EventBus.js";
import type {
  SecurityViolationEvent,
  CostThresholdEvent,
  AnomalyEvent,
  HealthEvent,
} from "../events/EventTypes.js";
import type { PluginContext, ModuleHealth } from "../plugin/PluginContext.js";
import { Logger } from "../utils/logger.js";

// ─── Data structures ────────────────────────────────────────────────────────

export interface StatusResponse {
  running: boolean;
  uptime: number;
  modules: readonly ModuleHealth[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
    disabled: number;
  };
}

export interface SecurityEvent {
  id: string;
  module: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  agentId: string;
  timestamp: number;
}

export interface CostEntry {
  agentId: string;
  currentCost: number;
  limit: number;
  percentUsed: number;
  timestamp: number;
}

export interface ComplianceStatus {
  mode: string;
  auditLogEnabled: boolean;
  dataRetention: {
    defaultDays: number;
    piiDays: number;
    auditDays: number;
  };
  checks: readonly ComplianceCheck[];
}

export interface ComplianceCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  event: string;
  module: string;
  agentId: string;
  detail: string;
}

export interface WsMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

// ─── Dashboard Provider ──────────────────────────────────────────────────────

/**
 * Provides data for the enterprise dashboard API.
 *
 * Collects events from the EventBus and exposes query methods
 * that map directly to dashboard API endpoints.
 */
export class DashboardProvider {
  private readonly context: PluginContext;
  private readonly logger: Logger;

  private readonly securityEvents: SecurityEvent[] = [];
  private readonly costEvents: CostEntry[] = [];
  private readonly auditEntries: AuditEntry[] = [];
  private readonly wsListeners = new Set<(msg: WsMessage) => void>();

  private readonly maxEvents: number;
  private eventCounter = 0;
  private subscriptions: Array<{ unsubscribe(): void }> = [];

  constructor(
    context: PluginContext,
    options?: { maxEvents?: number; logger?: Logger },
  ) {
    this.context = context;
    this.maxEvents = options?.maxEvents ?? 10_000;
    this.logger = options?.logger ?? new Logger("DashboardProvider");
    this.wireEventBus(context.eventBus);
  }

  destroy(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.wsListeners.clear();
  }

  // ─── API methods (map to REST endpoints) ────────────────────────────────

  /** GET /enterprise/status */
  getStatus(): StatusResponse {
    return {
      running: true,
      uptime: this.context.getUptime(),
      modules: this.context.getAllModuleHealth(),
      summary: this.context.getHealthSummary(),
    };
  }

  /** GET /enterprise/security/events */
  getSecurityEvents(options?: {
    limit?: number;
    offset?: number;
    severity?: string;
    module?: string;
  }): { events: readonly SecurityEvent[]; total: number } {
    let filtered: readonly SecurityEvent[] = this.securityEvents;

    if (options?.severity) {
      filtered = filtered.filter((e) => e.severity === options.severity);
    }
    if (options?.module) {
      filtered = filtered.filter((e) => e.module === options.module);
    }

    const total = filtered.length;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const events = filtered.slice(offset, offset + limit);

    return { events, total };
  }

  /** GET /enterprise/costs */
  getCosts(): {
    entries: readonly CostEntry[];
    totalCost: number;
    budget: number;
    percentUsed: number;
  } {
    const budget = this.context.config.infrastructure.costGovernor.monthlyBudgetUsd;
    let totalCost = 0;

    // Deduplicate by agentId, keep latest
    const byAgent = new Map<string, CostEntry>();
    for (const entry of this.costEvents) {
      byAgent.set(entry.agentId, entry);
    }
    for (const entry of byAgent.values()) {
      totalCost += entry.currentCost;
    }

    return {
      entries: Array.from(byAgent.values()),
      totalCost,
      budget,
      percentUsed: budget > 0 ? (totalCost / budget) * 100 : 0,
    };
  }

  /** GET /enterprise/compliance */
  getCompliance(): ComplianceStatus {
    const config = this.context.config;
    const checks: ComplianceCheck[] = [];

    checks.push({
      name: "Audit logging",
      passed: config.compliance.auditLog,
      detail: config.compliance.auditLog ? "Enabled" : "Disabled",
    });

    checks.push({
      name: "DLP enabled",
      passed: config.security.dlp.enabled,
      detail: config.security.dlp.enabled
        ? `Scanning for: ${config.security.dlp.piiTypes.join(", ")}`
        : "Disabled",
    });

    checks.push({
      name: "Injection protection",
      passed: config.security.injectionShield.enabled,
      detail: config.security.injectionShield.enabled
        ? `Mode: ${config.security.injectionShield.mode}`
        : "Disabled",
    });

    checks.push({
      name: "Content safety",
      passed: config.security.contentSafety.enabled,
      detail: config.security.contentSafety.enabled
        ? `Threshold: ${config.security.contentSafety.threshold}`
        : "Disabled",
    });

    checks.push({
      name: "Network policy",
      passed: config.security.networkPolicy.enabled,
      detail: config.security.networkPolicy.enabled
        ? `Block private: ${config.security.networkPolicy.blockPrivateRanges}`
        : "Disabled",
    });

    const piiRetentionOk =
      config.compliance.mode !== "gdpr" ||
      config.compliance.dataRetention.piiDays <= 30;
    checks.push({
      name: "PII data retention",
      passed: piiRetentionOk,
      detail: `${config.compliance.dataRetention.piiDays} days${!piiRetentionOk ? " (GDPR requires ≤30)" : ""}`,
    });

    return {
      mode: config.compliance.mode,
      auditLogEnabled: config.compliance.auditLog,
      dataRetention: { ...config.compliance.dataRetention },
      checks,
    };
  }

  /** GET /enterprise/audit */
  getAuditLog(options?: {
    limit?: number;
    offset?: number;
  }): { entries: readonly AuditEntry[]; total: number } {
    const total = this.auditEntries.length;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    return {
      entries: this.auditEntries.slice(offset, offset + limit),
      total,
    };
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────

  /** Register a WebSocket listener for real-time events */
  addWsListener(listener: (msg: WsMessage) => void): () => void {
    this.wsListeners.add(listener);
    return () => this.wsListeners.delete(listener);
  }

  // ─── Internal event wiring ──────────────────────────────────────────────

  private wireEventBus(eventBus: EventBus): void {
    this.subscriptions.push(
      eventBus.on("security:violation", (event) => {
        this.onSecurityViolation(event);
      }),
    );

    this.subscriptions.push(
      eventBus.on("cost:threshold", (event) => {
        this.onCostThreshold(event);
      }),
    );

    this.subscriptions.push(
      eventBus.on("anomaly:detected", (event) => {
        this.onAnomaly(event);
      }),
    );

    this.subscriptions.push(
      eventBus.on("health:change", (event) => {
        this.onHealthChange(event);
      }),
    );
  }

  private onSecurityViolation(event: SecurityViolationEvent): void {
    const entry: SecurityEvent = {
      id: `sec_${++this.eventCounter}`,
      module: event.module,
      severity: event.severity,
      description: event.description,
      agentId: event.agent.id,
      timestamp: event.timestamp,
    };
    this.pushWithLimit(this.securityEvents, entry);
    this.broadcast({ type: "security:violation", data: entry, timestamp: Date.now() });

    this.addAuditEntry("security:violation", event.module, event.agent.id, event.description);
  }

  private onCostThreshold(event: CostThresholdEvent): void {
    const entry: CostEntry = {
      agentId: event.agentId,
      currentCost: event.currentCost,
      limit: event.limit,
      percentUsed: event.percentUsed,
      timestamp: event.timestamp,
    };
    this.pushWithLimit(this.costEvents, entry);
    this.broadcast({ type: "cost:threshold", data: entry, timestamp: Date.now() });

    this.addAuditEntry(
      "cost:threshold",
      "CostGovernor",
      event.agentId,
      `${event.percentUsed.toFixed(1)}% of budget used`,
    );
  }

  private onAnomaly(event: AnomalyEvent): void {
    this.broadcast({ type: "anomaly:detected", data: event, timestamp: Date.now() });
    this.addAuditEntry(
      "anomaly:detected",
      "AnomalyDetector",
      event.agent.id,
      event.description,
    );
  }

  private onHealthChange(event: HealthEvent): void {
    this.context.setModuleHealth(event.module, {
      status: event.status,
      lastCheck: event.timestamp,
      message: event.message,
    });
    this.broadcast({ type: "health:change", data: event, timestamp: Date.now() });
  }

  private addAuditEntry(
    event: string,
    module: string,
    agentId: string,
    detail: string,
  ): void {
    const entry: AuditEntry = {
      id: `aud_${++this.eventCounter}`,
      timestamp: Date.now(),
      event,
      module,
      agentId,
      detail,
    };
    this.pushWithLimit(this.auditEntries, entry);
  }

  private pushWithLimit<T>(array: T[], item: T): void {
    array.push(item);
    if (array.length > this.maxEvents) {
      array.splice(0, array.length - this.maxEvents);
    }
  }

  private broadcast(msg: WsMessage): void {
    for (const listener of this.wsListeners) {
      try {
        listener(msg);
      } catch (err) {
        this.logger.error("WebSocket listener error", { error: String(err) });
      }
    }
  }
}
