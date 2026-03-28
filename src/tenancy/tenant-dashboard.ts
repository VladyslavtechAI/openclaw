/**
 * Tenant Dashboard for web UI data aggregation.
 * Provides real-time metrics: costs, usage, errors, agent status per tenant.
 */

import type { TenantConfig, TenantStatus } from "./tenant-manager.js";
import type { BudgetStatus } from "./tenant-billing.js";
import type { IsolationCheckResult } from "./tenant-isolation.js";

export type AgentStatus = {
  agentId: string;
  status: "active" | "idle" | "error" | "offline";
  lastActivity: number;
  requestCount: number;
  errorCount: number;
  model: string;
};

export type ErrorSummary = {
  total: number;
  byType: Map<string, number>;
  recent: Array<{
    timestamp: number;
    agentId: string;
    error: string;
    type: string;
  }>;
};

export type UsageMetrics = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  averageRequestCost: number;
  requestsByModel: Map<string, number>;
  costByModel: Map<string, number>;
};

export type DashboardSnapshot = {
  tenant: TenantConfig;
  timestamp: number;
  budget: BudgetStatus;
  usage: {
    daily: UsageMetrics;
    monthly: UsageMetrics;
  };
  agents: AgentStatus[];
  errors: ErrorSummary;
  isolation: {
    filesystemViolations: number;
    networkViolations: number;
    credentialLeaks: number;
  };
  health: {
    status: "healthy" | "warning" | "critical";
    issues: string[];
  };
};

export type AlertLevel = "info" | "warning" | "critical";

export type Alert = {
  id: string;
  level: AlertLevel;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  agentId?: string;
};

/**
 * Tenant Dashboard aggregates all tenant data for the web UI.
 */
export class TenantDashboard {
  private tenantId: string;
  private alerts: Alert[];
  private alertCounter: number;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.alerts = [];
    this.alertCounter = 0;
  }

  /**
   * Get comprehensive dashboard snapshot.
   */
  async getSnapshot(
    tenant: TenantConfig,
    budget: BudgetStatus,
    dailyUsage: UsageMetrics,
    monthlyUsage: UsageMetrics,
    agents: AgentStatus[],
    errors: ErrorSummary,
    isolationViolations: {
      filesystem: number;
      network: number;
      credentials: number;
    }
  ): Promise<DashboardSnapshot> {
    // Determine health status
    const health = this.assessHealth(budget, errors, isolationViolations);

    return {
      tenant,
      timestamp: Date.now(),
      budget,
      usage: {
        daily: dailyUsage,
        monthly: monthlyUsage,
      },
      agents,
      errors,
      isolation: {
        filesystemViolations: isolationViolations.filesystem,
        networkViolations: isolationViolations.network,
        credentialLeaks: isolationViolations.credentials,
      },
      health,
    };
  }

  /**
   * Assess overall tenant health.
   */
  assessHealth(
    budget: BudgetStatus,
    errors: ErrorSummary,
    isolationViolations: {
      filesystem: number;
      network: number;
      credentials: number;
    }
  ): { status: "healthy" | "warning" | "critical"; issues: string[] } {
    const issues: string[] = [];
    let status: "healthy" | "warning" | "critical" = "healthy";

    // Budget checks
    if (budget.isOverMonthlyBudget) {
      issues.push("Monthly budget exceeded");
      status = "critical";
    } else if (budget.monthlyPercentUsed > 90) {
      issues.push(`Budget ${budget.monthlyPercentUsed.toFixed(0)}% used`);
      status = status === "healthy" ? "warning" : status;
    } else if (budget.monthlyPercentUsed > 75) {
      issues.push(`Budget ${budget.monthlyPercentUsed.toFixed(0)}% used`);
      status = status === "healthy" ? "warning" : status;
    }

    // Error checks
    if (errors.total > 100) {
      issues.push(`High error rate: ${errors.total} errors`);
      status = "critical";
    } else if (errors.total > 50) {
      issues.push(`Elevated error rate: ${errors.total} errors`);
      status = status === "healthy" ? "warning" : status;
    }

    // Isolation violations
    const totalViolations =
      isolationViolations.filesystem +
      isolationViolations.network +
      isolationViolations.credentials;

    if (totalViolations > 0) {
      issues.push(`${totalViolations} security violations detected`);
      status = "critical";
    }

    return { status, issues };
  }

  /**
   * Create a new alert.
   */
  createAlert(level: AlertLevel, message: string, agentId?: string): Alert {
    const alert: Alert = {
      id: `alert_${++this.alertCounter}`,
      level,
      message,
      timestamp: Date.now(),
      acknowledged: false,
      agentId,
    };
    this.alerts.push(alert);
    return alert;
  }

  /**
   * Get unacknowledged alerts.
   */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * Get all alerts (acknowledged and unacknowledged).
   */
  getAllAlerts(limit = 100): Alert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Acknowledge an alert.
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) {
      return false;
    }
    alert.acknowledged = true;
    return true;
  }

  /**
   * Clear acknowledged alerts older than threshold.
   */
  clearOldAlerts(olderThanMs = 7 * 24 * 60 * 60 * 1000): number {
    const threshold = Date.now() - olderThanMs;
    const before = this.alerts.length;
    this.alerts = this.alerts.filter(
      (a) => !a.acknowledged || a.timestamp > threshold
    );
    return before - this.alerts.length;
  }

  /**
   * Generate usage trend data for charts.
   */
  generateUsageTrend(
    dailyUsages: Array<{ date: string; usage: UsageMetrics }>
  ): {
    dates: string[];
    costs: number[];
    requests: number[];
    avgCosts: number[];
  } {
    return {
      dates: dailyUsages.map((d) => d.date),
      costs: dailyUsages.map((d) => d.usage.totalCost),
      requests: dailyUsages.map((d) => d.usage.totalRequests),
      avgCosts: dailyUsages.map((d) => d.usage.averageRequestCost),
    };
  }

  /**
   * Generate agent performance comparison.
   */
  generateAgentComparison(agents: AgentStatus[]): Array<{
    agentId: string;
    successRate: number;
    requestCount: number;
    errorRate: number;
  }> {
    return agents.map((agent) => {
      const successRate =
        agent.requestCount > 0
          ? ((agent.requestCount - agent.errorCount) / agent.requestCount) * 100
          : 100;
      const errorRate =
        agent.requestCount > 0 ? (agent.errorCount / agent.requestCount) * 100 : 0;

      return {
        agentId: agent.agentId,
        successRate,
        requestCount: agent.requestCount,
        errorRate,
      };
    });
  }

  /**
   * Generate cost breakdown by category.
   */
  generateCostBreakdown(
    costByModel: Map<string, number>,
    totalCost: number
  ): Array<{
    category: string;
    cost: number;
    percentage: number;
  }> {
    const breakdown: Array<{
      category: string;
      cost: number;
      percentage: number;
    }> = [];

    for (const [model, cost] of costByModel) {
      breakdown.push({
        category: model,
        cost,
        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      });
    }

    return breakdown.sort((a, b) => b.cost - a.cost);
  }

  /**
   * Get budget forecast (predict when budget will be exceeded).
   */
  getBudgetForecast(
    dailyUsages: Array<{ date: string; usage: UsageMetrics }>,
    monthlyBudget: number
  ): {
    daysUntilExceeded: number;
    predictedMonthEnd: number;
    isOnTrack: boolean;
  } {
    if (dailyUsages.length === 0) {
      return {
        daysUntilExceeded: -1,
        predictedMonthEnd: 0,
        isOnTrack: true,
      };
    }

    // Calculate average daily cost from recent days
    const recentDays = Math.min(7, dailyUsages.length);
    const recentUsages = dailyUsages.slice(-recentDays);
    const avgDailyCost =
      recentUsages.reduce((sum, d) => sum + d.usage.totalCost, 0) / recentDays;

    // Current month progress
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - now.getDate();

    // Current spend
    const currentSpend = dailyUsages.reduce((sum, d) => sum + d.usage.totalCost, 0);

    // Predicted month-end spend
    const predictedMonthEnd = currentSpend + avgDailyCost * daysRemaining;

    // Days until budget exceeded
    const remainingBudget = monthlyBudget - currentSpend;
    const daysUntilExceeded =
      avgDailyCost > 0 ? Math.floor(remainingBudget / avgDailyCost) : -1;

    return {
      daysUntilExceeded,
      predictedMonthEnd,
      isOnTrack: predictedMonthEnd <= monthlyBudget,
    };
  }

  /**
   * Get top error types for troubleshooting.
   */
  getTopErrors(errors: ErrorSummary, limit = 5): Array<{ type: string; count: number }> {
    const sorted = Array.from(errors.byType.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return sorted.slice(0, limit);
  }

  /**
   * Generate summary statistics for the tenant.
   */
  getSummaryStats(snapshot: DashboardSnapshot): {
    activeAgents: number;
    totalAgents: number;
    todayRequests: number;
    todayCost: number;
    monthCost: number;
    errorRate: number;
    budgetRemaining: number;
  } {
    const activeAgents = snapshot.agents.filter(
      (a) => a.status === "active" || a.status === "idle"
    ).length;

    const errorRate =
      snapshot.usage.daily.totalRequests > 0
        ? (snapshot.errors.total / snapshot.usage.daily.totalRequests) * 100
        : 0;

    const budgetRemaining = Math.max(
      0,
      snapshot.budget.budget.monthly - snapshot.usage.monthly.totalCost
    );

    return {
      activeAgents,
      totalAgents: snapshot.agents.length,
      todayRequests: snapshot.usage.daily.totalRequests,
      todayCost: snapshot.usage.daily.totalCost,
      monthCost: snapshot.usage.monthly.totalCost,
      errorRate,
      budgetRemaining,
    };
  }
}
