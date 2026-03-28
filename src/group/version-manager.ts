/**
 * Version Manager: Per-company version pinning and controlled rollouts.
 * Features: version pinning, staged rollouts, canary deployments, per-company rollback.
 */

import type { CompanyId } from "./group-manager.js";

export type Version = string; // e.g., '2024.1.0'

export type VersionPin = {
  companyId: CompanyId;
  version: Version;
  /** When pinned */
  pinnedAt: number;
  /** Who pinned it */
  pinnedBy?: string;
  /** Reason for pinning */
  reason?: string;
};

export type RolloutStage = {
  /** Stage name */
  name: string;
  /** Companies in this stage */
  companyIds: CompanyId[];
  /** When stage started */
  startTime?: number;
  /** When stage completed */
  completionTime?: number;
  /** Stage status */
  status: "pending" | "in_progress" | "completed" | "failed";
  /** Failure reason if failed */
  failureReason?: string;
};

export type RolloutPlan = {
  /** Rollout ID */
  id: string;
  /** Target version */
  targetVersion: Version;
  /** Rollout stages */
  stages: RolloutStage[];
  /** Overall rollout status */
  status: "pending" | "in_progress" | "completed" | "failed" | "paused";
  /** When rollout was created */
  createdAt: number;
  /** When rollout started */
  startedAt?: number;
  /** When rollout completed */
  completedAt?: number;
  /** Rollout metadata */
  metadata?: Record<string, unknown>;
};

export type CanaryDeployment = {
  /** Canary ID */
  id: string;
  /** Version being tested */
  version: Version;
  /** Canary companies (small subset) */
  canaryCompanyIds: CompanyId[];
  /** When canary started */
  startTime: number;
  /** When canary should end */
  endTime: number;
  /** Canary status */
  status: "active" | "passed" | "failed";
  /** Health metrics */
  metrics?: {
    errorRate?: number;
    responseTime?: number;
    successRate?: number;
  };
  /** Whether canary should auto-promote */
  autoPromote: boolean;
};

/**
 * VersionManager handles version control across companies in a group.
 */
export class VersionManager {
  private versionPins: Map<CompanyId, VersionPin>;
  private rollouts: Map<string, RolloutPlan>;
  private canaryDeployments: Map<string, CanaryDeployment>;
  private defaultVersion: Version;

  constructor(defaultVersion: Version) {
    this.defaultVersion = defaultVersion;
    this.versionPins = new Map();
    this.rollouts = new Map();
    this.canaryDeployments = new Map();
  }

  /**
   * Get default version.
   */
  getDefaultVersion(): Version {
    return this.defaultVersion;
  }

  /**
   * Set default version for all unpinned companies.
   */
  setDefaultVersion(version: Version): void {
    this.defaultVersion = version;
  }

  /**
   * Get version for a company (pinned or default).
   */
  getCompanyVersion(companyId: CompanyId): Version {
    const pin = this.versionPins.get(companyId);
    return pin ? pin.version : this.defaultVersion;
  }

  /**
   * Pin a company to a specific version.
   */
  pinCompanyVersion(
    companyId: CompanyId,
    version: Version,
    options?: { pinnedBy?: string; reason?: string },
  ): VersionPin {
    const pin: VersionPin = {
      companyId,
      version,
      pinnedAt: Date.now(),
      pinnedBy: options?.pinnedBy,
      reason: options?.reason,
    };

    this.versionPins.set(companyId, pin);
    return pin;
  }

  /**
   * Unpin a company (returns to default version).
   */
  unpinCompanyVersion(companyId: CompanyId): void {
    this.versionPins.delete(companyId);
  }

  /**
   * Check if a company is pinned.
   */
  isCompanyPinned(companyId: CompanyId): boolean {
    return this.versionPins.has(companyId);
  }

  /**
   * Get all version pins.
   */
  getAllPins(): VersionPin[] {
    return Array.from(this.versionPins.values());
  }

  /**
   * Get companies by version.
   */
  getCompaniesByVersion(): Map<Version, CompanyId[]> {
    const byVersion = new Map<Version, CompanyId[]>();

    // Add pinned companies
    for (const [companyId, pin] of this.versionPins) {
      const companies = byVersion.get(pin.version) ?? [];
      companies.push(companyId);
      byVersion.set(pin.version, companies);
    }

    return byVersion;
  }

  /**
   * Create a staged rollout plan.
   */
  createRollout(
    targetVersion: Version,
    stages: Array<{ name: string; companyIds: CompanyId[] }>,
    metadata?: Record<string, unknown>,
  ): RolloutPlan {
    const rollout: RolloutPlan = {
      id: this.generateRolloutId(),
      targetVersion,
      stages: stages.map((s) => ({
        name: s.name,
        companyIds: s.companyIds,
        status: "pending",
      })),
      status: "pending",
      createdAt: Date.now(),
      metadata,
    };

    this.rollouts.set(rollout.id, rollout);
    return rollout;
  }

  /**
   * Get rollout by ID.
   */
  getRollout(rolloutId: string): RolloutPlan | undefined {
    return this.rollouts.get(rolloutId);
  }

  /**
   * List all rollouts.
   */
  listRollouts(statusFilter?: RolloutPlan["status"]): RolloutPlan[] {
    const rollouts = Array.from(this.rollouts.values());

    if (statusFilter) {
      return rollouts.filter((r) => r.status === statusFilter);
    }

    return rollouts.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Start a rollout.
   */
  startRollout(rolloutId: string): RolloutPlan {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout ${rolloutId} not found`);
    }

    if (rollout.status !== "pending") {
      throw new Error(`Rollout ${rolloutId} is not in pending state`);
    }

    rollout.status = "in_progress";
    rollout.startedAt = Date.now();

    // Start first stage
    if (rollout.stages.length > 0) {
      rollout.stages[0].status = "in_progress";
      rollout.stages[0].startTime = Date.now();
    }

    this.rollouts.set(rolloutId, rollout);
    return rollout;
  }

  /**
   * Complete a rollout stage and move to next.
   */
  completeRolloutStage(rolloutId: string, stageName: string): RolloutPlan {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout ${rolloutId} not found`);
    }

    const stageIndex = rollout.stages.findIndex((s) => s.name === stageName);
    if (stageIndex === -1) {
      throw new Error(`Stage ${stageName} not found in rollout ${rolloutId}`);
    }

    const stage = rollout.stages[stageIndex];
    stage.status = "completed";
    stage.completionTime = Date.now();

    // Pin companies in this stage to target version
    for (const companyId of stage.companyIds) {
      this.pinCompanyVersion(companyId, rollout.targetVersion, {
        reason: `Rollout ${rolloutId} stage ${stageName}`,
      });
    }

    // Start next stage if exists
    if (stageIndex + 1 < rollout.stages.length) {
      const nextStage = rollout.stages[stageIndex + 1];
      nextStage.status = "in_progress";
      nextStage.startTime = Date.now();
    } else {
      // All stages completed
      rollout.status = "completed";
      rollout.completedAt = Date.now();
    }

    this.rollouts.set(rolloutId, rollout);
    return rollout;
  }

  /**
   * Fail a rollout stage.
   */
  failRolloutStage(rolloutId: string, stageName: string, reason: string): RolloutPlan {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout ${rolloutId} not found`);
    }

    const stage = rollout.stages.find((s) => s.name === stageName);
    if (!stage) {
      throw new Error(`Stage ${stageName} not found in rollout ${rolloutId}`);
    }

    stage.status = "failed";
    stage.failureReason = reason;
    stage.completionTime = Date.now();

    rollout.status = "failed";
    this.rollouts.set(rolloutId, rollout);

    return rollout;
  }

  /**
   * Pause a rollout.
   */
  pauseRollout(rolloutId: string): RolloutPlan {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout ${rolloutId} not found`);
    }

    if (rollout.status !== "in_progress") {
      throw new Error(`Rollout ${rolloutId} is not in progress`);
    }

    rollout.status = "paused";
    this.rollouts.set(rolloutId, rollout);

    return rollout;
  }

  /**
   * Resume a paused rollout.
   */
  resumeRollout(rolloutId: string): RolloutPlan {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout ${rolloutId} not found`);
    }

    if (rollout.status !== "paused") {
      throw new Error(`Rollout ${rolloutId} is not paused`);
    }

    rollout.status = "in_progress";
    this.rollouts.set(rolloutId, rollout);

    return rollout;
  }

  /**
   * Rollback a company to a previous version.
   */
  rollbackCompany(companyId: CompanyId, targetVersion: Version, reason?: string): VersionPin {
    return this.pinCompanyVersion(companyId, targetVersion, {
      reason: reason ?? "Rollback",
    });
  }

  /**
   * Create a canary deployment.
   */
  createCanary(
    version: Version,
    canaryCompanyIds: CompanyId[],
    durationMs: number,
    autoPromote = false,
  ): CanaryDeployment {
    const canary: CanaryDeployment = {
      id: this.generateCanaryId(),
      version,
      canaryCompanyIds,
      startTime: Date.now(),
      endTime: Date.now() + durationMs,
      status: "active",
      autoPromote,
    };

    // Pin canary companies to test version
    for (const companyId of canaryCompanyIds) {
      this.pinCompanyVersion(companyId, version, {
        reason: `Canary deployment ${canary.id}`,
      });
    }

    this.canaryDeployments.set(canary.id, canary);
    return canary;
  }

  /**
   * Get canary deployment by ID.
   */
  getCanary(canaryId: string): CanaryDeployment | undefined {
    return this.canaryDeployments.get(canaryId);
  }

  /**
   * Update canary metrics.
   */
  updateCanaryMetrics(
    canaryId: string,
    metrics: { errorRate?: number; responseTime?: number; successRate?: number },
  ): void {
    const canary = this.canaryDeployments.get(canaryId);
    if (!canary) {
      throw new Error(`Canary ${canaryId} not found`);
    }

    canary.metrics = { ...canary.metrics, ...metrics };
    this.canaryDeployments.set(canaryId, canary);
  }

  /**
   * Pass a canary deployment (promote to all companies).
   */
  passCanary(canaryId: string): CanaryDeployment {
    const canary = this.canaryDeployments.get(canaryId);
    if (!canary) {
      throw new Error(`Canary ${canaryId} not found`);
    }

    canary.status = "passed";
    this.canaryDeployments.set(canaryId, canary);

    return canary;
  }

  /**
   * Fail a canary deployment (rollback canary companies).
   */
  failCanary(canaryId: string): CanaryDeployment {
    const canary = this.canaryDeployments.get(canaryId);
    if (!canary) {
      throw new Error(`Canary ${canaryId} not found`);
    }

    canary.status = "failed";

    // Rollback canary companies to default version
    for (const companyId of canary.canaryCompanyIds) {
      this.unpinCompanyVersion(companyId);
    }

    this.canaryDeployments.set(canaryId, canary);
    return canary;
  }

  /**
   * Check for expired canaries and handle auto-promotion.
   */
  checkCanaries(): CanaryDeployment[] {
    const now = Date.now();
    const updated: CanaryDeployment[] = [];

    for (const canary of this.canaryDeployments.values()) {
      if (canary.status === "active" && now >= canary.endTime) {
        if (canary.autoPromote) {
          this.passCanary(canary.id);
          updated.push(canary);
        }
      }
    }

    return updated;
  }

  /**
   * List active canary deployments.
   */
  listActiveCanaries(): CanaryDeployment[] {
    return Array.from(this.canaryDeployments.values())
      .filter((c) => c.status === "active")
      .sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Generate unique rollout ID.
   */
  private generateRolloutId(): string {
    return `rollout-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate unique canary ID.
   */
  private generateCanaryId(): string {
    return `canary-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
