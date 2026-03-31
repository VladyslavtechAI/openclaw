/**
 * Alert system for observability events.
 * Evaluates rules against events and dispatches notifications
 * via Telegram, webhooks, or file log.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ObservabilityEvent, EventLevel, EventCategory, StoredEvent } from "./event-logger.js";

export type AlertConditionType =
  | "threshold"
  | "rate"
  | "match";

export type AlertCondition = {
  type: AlertConditionType;
  /** For "match": trigger on events matching these fields. */
  level?: EventLevel;
  levels?: EventLevel[];
  category?: EventCategory;
  event?: string;
  /** For "threshold": numeric field in event.data to check. */
  field?: string;
  /** For "threshold": trigger when field exceeds this value. */
  threshold?: number;
  /** For "rate": max events in the given window (seconds). */
  maxCount?: number;
  /** For "rate": sliding window in seconds. */
  windowSeconds?: number;
};

export type AlertChannelType = "telegram" | "webhook" | "file";

export type AlertChannel = {
  type: AlertChannelType;
  /** Telegram bot token (for type=telegram). */
  botToken?: string;
  /** Telegram chat ID (for type=telegram). */
  chatId?: string;
  /** Webhook URL (for type=webhook). */
  url?: string;
  /** File path (for type=file). */
  filePath?: string;
};

export type AlertRule = {
  id: string;
  name: string;
  condition: AlertCondition;
  channels: AlertChannel[];
  /** Minimum seconds between repeated alerts for this rule. */
  cooldown: number;
  severity: "info" | "warning" | "critical";
  enabled?: boolean;
};

export type Alert = {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  message: string;
  triggeredAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  event: ObservabilityEvent;
};

export type AlertManagerConfig = {
  /** Directory for alert log files. */
  logDir?: string;
  /** Custom fetch function for testing. */
  fetchFn?: typeof fetch;
};

type RateWindow = {
  timestamps: number[];
};

/**
 * Alert manager that evaluates rules against events and dispatches notifications.
 */
export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private lastFired: Map<string, number> = new Map();
  private rateWindows: Map<string, RateWindow> = new Map();
  private logDir: string | undefined;
  private fetchFn: typeof fetch;

  constructor(config: AlertManagerConfig = {}) {
    this.logDir = config.logDir;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    if (this.logDir) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Add or update an alert rule.
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, { ...rule, enabled: rule.enabled ?? true });
  }

  /**
   * Remove an alert rule by ID.
   */
  removeRule(id: string): void {
    this.rules.delete(id);
    this.rateWindows.delete(id);
  }

  /**
   * Get a rule by ID.
   */
  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Get all registered rules.
   */
  getRules(): AlertRule[] {
    return [...this.rules.values()];
  }

  /**
   * Evaluate an event against all rules and fire alerts as needed.
   */
  async evaluate(event: ObservabilityEvent | StoredEvent): Promise<Alert[]> {
    const fired: Alert[] = [];

    for (const rule of this.rules.values()) {
      if (rule.enabled === false) continue;

      const shouldFire = this.checkCondition(rule, event);
      if (!shouldFire) continue;

      // Check cooldown
      const lastTime = this.lastFired.get(rule.id) ?? 0;
      const now = Date.now();
      if (now - lastTime < rule.cooldown * 1000) continue;

      const alert = this.createAlert(rule, event);
      this.activeAlerts.set(alert.id, alert);
      this.lastFired.set(rule.id, now);
      fired.push(alert);

      // Dispatch to channels (fire-and-forget, never crash)
      this.dispatch(rule.channels, alert).catch(() => {});
    }

    return fired;
  }

  /**
   * Get all active (unacknowledged) alerts.
   */
  getActiveAlerts(): Alert[] {
    return [...this.activeAlerts.values()].filter((a) => !a.acknowledged);
  }

  /**
   * Get all alerts including acknowledged ones.
   */
  getAllAlerts(): Alert[] {
    return [...this.activeAlerts.values()];
  }

  /**
   * Acknowledge an alert by ID.
   */
  acknowledge(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    return true;
  }

  /**
   * Clear all acknowledged alerts from the active list.
   */
  clearAcknowledged(): number {
    let cleared = 0;
    for (const [id, alert] of this.activeAlerts) {
      if (alert.acknowledged) {
        this.activeAlerts.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  private checkCondition(rule: AlertRule, event: ObservabilityEvent): boolean {
    const { condition } = rule;

    switch (condition.type) {
      case "match":
        return this.checkMatchCondition(condition, event);
      case "threshold":
        return this.checkThresholdCondition(condition, event);
      case "rate":
        return this.checkRateCondition(rule.id, condition, event);
      default:
        return false;
    }
  }

  private checkMatchCondition(condition: AlertCondition, event: ObservabilityEvent): boolean {
    if (condition.level && event.level !== condition.level) return false;
    if (condition.levels && !condition.levels.includes(event.level)) return false;
    if (condition.category && event.category !== condition.category) return false;
    if (condition.event && event.event !== condition.event) return false;
    return true;
  }

  private checkThresholdCondition(condition: AlertCondition, event: ObservabilityEvent): boolean {
    if (!condition.field || condition.threshold === undefined) return false;

    // Also check match fields if specified
    if (condition.category && event.category !== condition.category) return false;
    if (condition.event && event.event !== condition.event) return false;

    const value = event.data?.[condition.field];
    if (typeof value !== "number") return false;
    return value > condition.threshold;
  }

  private checkRateCondition(ruleId: string, condition: AlertCondition, event: ObservabilityEvent): boolean {
    // Check match fields first
    if (condition.category && event.category !== condition.category) return false;
    if (condition.level && event.level !== condition.level) return false;
    if (condition.levels && !condition.levels.includes(event.level)) return false;

    const windowSec = condition.windowSeconds ?? 600;
    const maxCount = condition.maxCount ?? 5;
    const now = Date.now();
    const cutoff = now - windowSec * 1000;

    let window = this.rateWindows.get(ruleId);
    if (!window) {
      window = { timestamps: [] };
      this.rateWindows.set(ruleId, window);
    }

    // Clean expired timestamps and add new one
    window.timestamps = window.timestamps.filter((t) => t > cutoff);
    window.timestamps.push(now);

    return window.timestamps.length > maxCount;
  }

  private createAlert(rule: AlertRule, event: ObservabilityEvent): Alert {
    return {
      id: crypto.randomBytes(8).toString("hex"),
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      message: `[${rule.severity.toUpperCase()}] ${rule.name}: ${event.event} on ${event.machine}`,
      triggeredAt: new Date().toISOString(),
      acknowledged: false,
      event,
    };
  }

  private async dispatch(channels: AlertChannel[], alert: Alert): Promise<void> {
    for (const channel of channels) {
      try {
        switch (channel.type) {
          case "telegram":
            await this.sendTelegram(channel, alert);
            break;
          case "webhook":
            await this.sendWebhook(channel, alert);
            break;
          case "file":
            this.writeFileAlert(channel, alert);
            break;
        }
      } catch {
        // Channel dispatch failures must not crash the gateway
      }
    }
  }

  private async sendTelegram(channel: AlertChannel, alert: Alert): Promise<void> {
    if (!channel.botToken || !channel.chatId) return;
    const url = `https://api.telegram.org/bot${channel.botToken}/sendMessage`;
    await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channel.chatId,
        text: alert.message,
        parse_mode: "HTML",
      }),
    });
  }

  private async sendWebhook(channel: AlertChannel, alert: Alert): Promise<void> {
    if (!channel.url) return;
    await this.fetchFn(channel.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alert),
    });
  }

  private writeFileAlert(channel: AlertChannel, alert: Alert): void {
    const filePath = channel.filePath ?? (this.logDir ? path.join(this.logDir, "alerts.jsonl") : undefined);
    if (!filePath) return;
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(alert) + "\n");
  }
}
