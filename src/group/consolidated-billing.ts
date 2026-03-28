/**
 * Consolidated Billing: Per-company cost tracking with group-level rollup.
 * Features: per-company budgets, inter-company cost allocation, budget enforcement.
 */

import fs from "node:fs";
import path from "node:path";
import type { CompanyId } from "./group-manager.js";

export type BillingRecord = {
  timestamp: number;
  companyId: CompanyId;
  /** Cost category (e.g., 'compute', 'storage', 'shared-service') */
  category: string;
  /** Amount in USD */
  amount: number;
  /** Description */
  description?: string;
  /** Source of cost (e.g., agent ID, service ID) */
  source?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
};

export type CompanyBudget = {
  companyId: CompanyId;
  /** Daily budget in USD (0 = unlimited) */
  dailyBudget: number;
  /** Monthly budget in USD (0 = unlimited) */
  monthlyBudget: number;
  /** Whether to block when budget exceeded */
  blockOnExceed: boolean;
  /** Alert threshold percentage (e.g., 80 = alert at 80%) */
  alertThreshold: number;
};

export type BudgetStatus = {
  companyId: CompanyId;
  dailySpent: number;
  dailyBudget: number;
  dailyPercentUsed: number;
  monthlySpent: number;
  monthlyBudget: number;
  monthlyPercentUsed: number;
  isOverBudget: boolean;
  shouldAlert: boolean;
};

export type GroupBudgetSummary = {
  totalDailySpent: number;
  totalMonthlySpent: number;
  companiesOverBudget: CompanyId[];
  companiesNearBudget: CompanyId[];
  topSpenders: Array<{ companyId: CompanyId; amount: number }>;
};

/**
 * ConsolidatedBilling manages billing across all companies in a group.
 */
export class ConsolidatedBilling {
  private dataDir: string;
  private records: BillingRecord[];
  private budgets: Map<CompanyId, CompanyBudget>;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.records = [];
    this.budgets = new Map();

    fs.mkdirSync(dataDir, { recursive: true });
    this.loadRecords();
    this.loadBudgets();
  }

  /**
   * Record a billing event.
   */
  recordCost(
    companyId: CompanyId,
    category: string,
    amount: number,
    options?: {
      description?: string;
      source?: string;
      metadata?: Record<string, unknown>;
    },
  ): BillingRecord {
    const record: BillingRecord = {
      timestamp: Date.now(),
      companyId,
      category,
      amount,
      description: options?.description,
      source: options?.source,
      metadata: options?.metadata,
    };

    this.records.push(record);
    this.appendRecordToFile(record);

    return record;
  }

  /**
   * Set budget for a company.
   */
  setCompanyBudget(budget: CompanyBudget): void {
    this.budgets.set(budget.companyId, budget);
    this.saveBudgets();
  }

  /**
   * Get budget for a company.
   */
  getCompanyBudget(companyId: CompanyId): CompanyBudget | undefined {
    return this.budgets.get(companyId);
  }

  /**
   * Check budget status for a company.
   */
  checkBudgetStatus(companyId: CompanyId): BudgetStatus {
    const budget = this.budgets.get(companyId);

    const dailySpent = this.getDailyCost(companyId);
    const monthlySpent = this.getMonthlyCost(companyId);

    const dailyBudget = budget?.dailyBudget ?? 0;
    const monthlyBudget = budget?.monthlyBudget ?? 0;

    const dailyPercentUsed = dailyBudget > 0 ? (dailySpent / dailyBudget) * 100 : 0;
    const monthlyPercentUsed = monthlyBudget > 0 ? (monthlySpent / monthlyBudget) * 100 : 0;

    const isOverBudget =
      (dailyBudget > 0 && dailySpent >= dailyBudget) ||
      (monthlyBudget > 0 && monthlySpent >= monthlyBudget);

    const alertThreshold = budget?.alertThreshold ?? 80;
    const shouldAlert = dailyPercentUsed >= alertThreshold || monthlyPercentUsed >= alertThreshold;

    return {
      companyId,
      dailySpent,
      dailyBudget,
      dailyPercentUsed,
      monthlySpent,
      monthlyBudget,
      monthlyPercentUsed,
      isOverBudget,
      shouldAlert,
    };
  }

  /**
   * Check if company can spend more (budget enforcement).
   */
  canCompanySpend(companyId: CompanyId, amount: number): { allowed: boolean; reason?: string } {
    const budget = this.budgets.get(companyId);

    // No budget = unlimited
    if (!budget) {
      return { allowed: true };
    }

    if (!budget.blockOnExceed) {
      return { allowed: true };
    }

    const status = this.checkBudgetStatus(companyId);

    if (budget.dailyBudget > 0 && status.dailySpent + amount > budget.dailyBudget) {
      return { allowed: false, reason: "Daily budget exceeded" };
    }

    if (budget.monthlyBudget > 0 && status.monthlySpent + amount > budget.monthlyBudget) {
      return { allowed: false, reason: "Monthly budget exceeded" };
    }

    return { allowed: true };
  }

  /**
   * Get daily cost for a company.
   */
  getDailyCost(companyId: CompanyId, date?: Date): number {
    const records = this.getRecordsForDay(companyId, date);
    return records.reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Get monthly cost for a company.
   */
  getMonthlyCost(companyId: CompanyId, date?: Date): number {
    const records = this.getRecordsForMonth(companyId, date);
    return records.reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Get cost breakdown by category for a company.
   */
  getCostByCategory(
    companyId: CompanyId,
    startTime?: number,
    endTime?: number,
  ): Map<string, number> {
    const records = this.getRecords(companyId, startTime, endTime);
    const breakdown = new Map<string, number>();

    for (const record of records) {
      const current = breakdown.get(record.category) ?? 0;
      breakdown.set(record.category, current + record.amount);
    }

    return breakdown;
  }

  /**
   * Get group-wide budget summary.
   */
  getGroupSummary(): GroupBudgetSummary {
    const companies = Array.from(this.budgets.keys());

    const dailySpending = new Map<CompanyId, number>();
    const monthlySpending = new Map<CompanyId, number>();

    let totalDailySpent = 0;
    let totalMonthlySpent = 0;

    for (const companyId of companies) {
      const daily = this.getDailyCost(companyId);
      const monthly = this.getMonthlyCost(companyId);

      dailySpending.set(companyId, daily);
      monthlySpending.set(companyId, monthly);

      totalDailySpent += daily;
      totalMonthlySpent += monthly;
    }

    const companiesOverBudget: CompanyId[] = [];
    const companiesNearBudget: CompanyId[] = [];

    for (const companyId of companies) {
      const status = this.checkBudgetStatus(companyId);

      if (status.isOverBudget) {
        companiesOverBudget.push(companyId);
      } else if (status.shouldAlert) {
        companiesNearBudget.push(companyId);
      }
    }

    const topSpenders = Array.from(monthlySpending.entries())
      .map(([companyId, amount]) => ({ companyId, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    return {
      totalDailySpent,
      totalMonthlySpent,
      companiesOverBudget,
      companiesNearBudget,
      topSpenders,
    };
  }

  /**
   * Allocate cost from one company to another (inter-company billing).
   */
  allocateCost(
    fromCompanyId: CompanyId,
    toCompanyId: CompanyId,
    amount: number,
    description: string,
  ): BillingRecord {
    // Credit the source company
    this.recordCost(fromCompanyId, "inter-company-credit", -amount, {
      description: `Credit to ${toCompanyId}: ${description}`,
      metadata: { targetCompany: toCompanyId },
    });

    // Charge the target company
    return this.recordCost(toCompanyId, "inter-company-charge", amount, {
      description: `Charge from ${fromCompanyId}: ${description}`,
      source: fromCompanyId,
      metadata: { sourceCompany: fromCompanyId },
    });
  }

  /**
   * Get all billing records for a company.
   */
  getRecords(companyId: CompanyId, startTime?: number, endTime?: number): BillingRecord[] {
    let records = this.records.filter((r) => r.companyId === companyId);

    if (startTime) {
      records = records.filter((r) => r.timestamp >= startTime);
    }

    if (endTime) {
      records = records.filter((r) => r.timestamp <= endTime);
    }

    return records.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get records for a specific day.
   */
  private getRecordsForDay(companyId: CompanyId, date?: Date): BillingRecord[] {
    const d = date ?? new Date();
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

    return this.records.filter(
      (r) => r.companyId === companyId && r.timestamp >= startOfDay && r.timestamp < endOfDay,
    );
  }

  /**
   * Get records for a specific month.
   */
  private getRecordsForMonth(companyId: CompanyId, date?: Date): BillingRecord[] {
    const d = date ?? new Date();
    const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();

    return this.records.filter(
      (r) => r.companyId === companyId && r.timestamp >= startOfMonth && r.timestamp <= endOfMonth,
    );
  }

  /**
   * Load billing records from disk.
   */
  private loadRecords(): void {
    const recordsPath = path.join(this.dataDir, "billing-records.jsonl");

    if (!fs.existsSync(recordsPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(recordsPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as BillingRecord;
          this.records.push(record);
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  /**
   * Append a billing record to disk.
   */
  private appendRecordToFile(record: BillingRecord): void {
    const recordsPath = path.join(this.dataDir, "billing-records.jsonl");
    fs.appendFileSync(recordsPath, JSON.stringify(record) + "\n");
  }

  /**
   * Load budgets from disk.
   */
  private loadBudgets(): void {
    const budgetsPath = path.join(this.dataDir, "budgets.json");

    if (!fs.existsSync(budgetsPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(budgetsPath, "utf-8");
      const budgets = JSON.parse(content) as CompanyBudget[];

      for (const budget of budgets) {
        this.budgets.set(budget.companyId, budget);
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Save budgets to disk.
   */
  private saveBudgets(): void {
    const budgetsPath = path.join(this.dataDir, "budgets.json");
    const budgets = Array.from(this.budgets.values());
    fs.writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2));
  }

  /**
   * Clear old billing records (data retention).
   */
  clearOldRecords(beforeTimestamp: number): number {
    const beforeCount = this.records.length;
    this.records = this.records.filter((r) => r.timestamp >= beforeTimestamp);
    return beforeCount - this.records.length;
  }

  /**
   * Generate invoice data for a company.
   */
  generateInvoice(
    companyId: CompanyId,
    startTime: number,
    endTime: number,
  ): {
    companyId: CompanyId;
    startTime: number;
    endTime: number;
    totalAmount: number;
    categoryBreakdown: Map<string, number>;
    records: BillingRecord[];
  } {
    const records = this.getRecords(companyId, startTime, endTime);
    const totalAmount = records.reduce((sum, r) => sum + r.amount, 0);
    const categoryBreakdown = this.getCostByCategory(companyId, startTime, endTime);

    return {
      companyId,
      startTime,
      endTime,
      totalAmount,
      categoryBreakdown,
      records,
    };
  }
}
