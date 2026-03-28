/**
 * Tenant Billing for per-tenant usage tracking.
 * JSONL-based tracking, budget caps, invoice generation, overspend prevention.
 */

import fs from "node:fs";
import path from "node:path";
import { CostTracker } from "../billing/cost-tracker.js";
import type { UsageRecord, AgentBudgetConfig } from "../billing/cost-tracker.js";

export type TenantBudget = {
  /** Daily budget in USD */
  daily: number;
  /** Monthly budget in USD */
  monthly: number;
  /** Whether to block requests when budget exceeded */
  blockOnExceed: boolean;
  /** Model to downgrade to when budget exceeded */
  modelOnExceed?: string;
};

export type InvoiceLineItem = {
  date: string;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

export type Invoice = {
  tenantId: string;
  period: { start: string; end: string };
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  generatedAt: number;
};

export type BudgetStatus = {
  tenantId: string;
  budget: TenantBudget;
  dailyCost: number;
  monthlyCost: number;
  dailyPercentUsed: number;
  monthlyPercentUsed: number;
  isOverDailyBudget: boolean;
  isOverMonthlyBudget: boolean;
  shouldBlock: boolean;
  downgradeTo?: string;
};

/**
 * Tenant Billing tracks usage and enforces budget caps per tenant.
 */
export class TenantBilling {
  private tenantId: string;
  private billingDir: string;
  private costTracker: CostTracker;
  private budget: TenantBudget;

  constructor(tenantId: string, billingDir: string, budget: TenantBudget) {
    this.tenantId = tenantId;
    this.billingDir = billingDir;
    this.budget = budget;

    // Create billing directory
    fs.mkdirSync(billingDir, { recursive: true });

    // Initialize cost tracker (JSONL files)
    this.costTracker = new CostTracker(billingDir);
  }

  /**
   * Track a request's token usage and cost.
   */
  trackRequest(
    agentId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens = 0,
    sessionKey?: string
  ): UsageRecord {
    return this.costTracker.trackRequest(
      agentId,
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      sessionKey
    );
  }

  /**
   * Check if tenant is within budget before making a request.
   */
  checkBudget(): BudgetStatus {
    const dailyCost = this.getDailyCost();
    const monthlyCost = this.getMonthlyCost();

    const dailyPercentUsed = (dailyCost / this.budget.daily) * 100;
    const monthlyPercentUsed = (monthlyCost / this.budget.monthly) * 100;

    const isOverDailyBudget = dailyCost >= this.budget.daily;
    const isOverMonthlyBudget = monthlyCost >= this.budget.monthly;

    const shouldBlock =
      this.budget.blockOnExceed && (isOverDailyBudget || isOverMonthlyBudget);

    const downgradeTo =
      !shouldBlock && (isOverDailyBudget || isOverMonthlyBudget)
        ? this.budget.modelOnExceed
        : undefined;

    return {
      tenantId: this.tenantId,
      budget: this.budget,
      dailyCost,
      monthlyCost,
      dailyPercentUsed,
      monthlyPercentUsed,
      isOverDailyBudget,
      isOverMonthlyBudget,
      shouldBlock,
      downgradeTo,
    };
  }

  /**
   * Get current daily cost for this tenant.
   */
  getDailyCost(date?: Date): number {
    return this.costTracker.getTotalDailyCost(date);
  }

  /**
   * Get current monthly cost for this tenant.
   */
  getMonthlyCost(year?: number, month?: number): number {
    const now = new Date();
    const targetYear = year ?? now.getFullYear();
    const targetMonth = month ?? now.getMonth();

    let totalCost = 0;
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(targetYear, targetMonth, day);
      if (date > now) break; // Don't include future days
      totalCost += this.costTracker.getTotalDailyCost(date);
    }

    return totalCost;
  }

  /**
   * Get cost breakdown by agent for today.
   */
  getDailyCostByAgent(date?: Date): Map<string, number> {
    return this.costTracker.getDailyCostByAgent(date);
  }

  /**
   * Get cost breakdown by model for today.
   */
  getDailyCostByModel(date?: Date): Map<string, number> {
    return this.costTracker.getDailyCostByModel(date);
  }

  /**
   * Get usage summary for a specific agent.
   */
  getAgentUsageSummary(
    agentId: string,
    date?: Date
  ): { totalInput: number; totalOutput: number; totalCost: number; requestCount: number } {
    return this.costTracker.getAgentUsageSummary(agentId, date);
  }

  /**
   * Generate invoice for a date range.
   */
  generateInvoice(startDate: Date, endDate: Date, taxRate = 0): Invoice {
    const lineItems: InvoiceLineItem[] = [];
    let subtotal = 0;

    // Collect all usage records in the date range
    const current = new Date(startDate);
    while (current <= endDate) {
      const records = this.readDailyRecords(current);
      const dateStr = current.toISOString().slice(0, 10);

      for (const record of records) {
        lineItems.push({
          date: dateStr,
          agentId: record.agentId,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          cost: record.cost,
        });
        subtotal += record.cost;
      }

      current.setDate(current.getDate() + 1);
    }

    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    const invoice: Invoice = {
      tenantId: this.tenantId,
      period: {
        start: startDate.toISOString().slice(0, 10),
        end: endDate.toISOString().slice(0, 10),
      },
      lineItems,
      subtotal,
      tax,
      total,
      generatedAt: Date.now(),
    };

    // Save invoice to disk
    this.saveInvoice(invoice);

    return invoice;
  }

  /**
   * Generate monthly invoice.
   */
  generateMonthlyInvoice(year: number, month: number, taxRate = 0): Invoice {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0); // Last day of month
    return this.generateInvoice(startDate, endDate, taxRate);
  }

  /**
   * Get historical invoices.
   */
  getInvoices(): Invoice[] {
    const invoicesDir = path.join(this.billingDir, "invoices");
    if (!fs.existsSync(invoicesDir)) {
      return [];
    }

    const files = fs.readdirSync(invoicesDir).filter((f) => f.endsWith(".json"));
    const invoices: Invoice[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(invoicesDir, file), "utf-8");
        invoices.push(JSON.parse(content) as Invoice);
      } catch {
        // Skip invalid invoices
      }
    }

    return invoices.sort((a, b) => b.generatedAt - a.generatedAt);
  }

  /**
   * Update budget settings.
   */
  updateBudget(updates: Partial<TenantBudget>): TenantBudget {
    this.budget = { ...this.budget, ...updates };
    this.saveBudgetConfig();
    return this.budget;
  }

  /**
   * Get current budget settings.
   */
  getBudget(): TenantBudget {
    return { ...this.budget };
  }

  /**
   * Predict if next request will exceed budget.
   */
  willExceedBudget(estimatedCost: number): {
    willExceedDaily: boolean;
    willExceedMonthly: boolean;
    remainingDaily: number;
    remainingMonthly: number;
  } {
    const dailyCost = this.getDailyCost();
    const monthlyCost = this.getMonthlyCost();

    return {
      willExceedDaily: dailyCost + estimatedCost > this.budget.daily,
      willExceedMonthly: monthlyCost + estimatedCost > this.budget.monthly,
      remainingDaily: Math.max(0, this.budget.daily - dailyCost),
      remainingMonthly: Math.max(0, this.budget.monthly - monthlyCost),
    };
  }

  /**
   * Read usage records for a specific day.
   */
  private readDailyRecords(date: Date): UsageRecord[] {
    const dateStr = date.toISOString().slice(0, 10);
    const filePath = path.join(this.billingDir, `usage-${dateStr}.jsonl`);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as UsageRecord);
    } catch {
      return [];
    }
  }

  /**
   * Save invoice to disk.
   */
  private saveInvoice(invoice: Invoice): void {
    const invoicesDir = path.join(this.billingDir, "invoices");
    fs.mkdirSync(invoicesDir, { recursive: true });

    const filename = `invoice-${invoice.period.start}-to-${invoice.period.end}.json`;
    const filePath = path.join(invoicesDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(invoice, null, 2));
  }

  /**
   * Save budget configuration to disk.
   */
  private saveBudgetConfig(): void {
    const configPath = path.join(this.billingDir, "budget.json");
    fs.writeFileSync(configPath, JSON.stringify(this.budget, null, 2));
  }

  /**
   * Load budget configuration from disk.
   */
  static loadBudgetConfig(billingDir: string): TenantBudget | undefined {
    const configPath = path.join(billingDir, "budget.json");
    if (!fs.existsSync(configPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content) as TenantBudget;
    } catch {
      return undefined;
    }
  }
}
