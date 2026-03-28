/**
 * Shared Service Registry: Agents available across companies.
 * Features: cross-company agent sharing, access control per company, usage attribution.
 */

import type { CompanyId } from "./group-manager.js";

export type SharedServiceId = string;

export type SharedService = {
  /** Unique service ID */
  id: SharedServiceId;
  /** Service name (e.g., 'Legal', 'HR', 'IT Support') */
  name: string;
  /** Service description */
  description?: string;
  /** Agent IDs that provide this service */
  agentIds: string[];
  /** Companies allowed to use this service (empty = all) */
  allowedCompanyIds: CompanyId[];
  /** Whether service is currently available */
  available: boolean;
  /** Service tier (affects billing) */
  tier: "basic" | "premium" | "enterprise";
  /** Cost per request in USD */
  costPerRequest?: number;
  /** Maximum concurrent requests */
  maxConcurrentRequests?: number;
  /** Service metadata */
  metadata?: Record<string, unknown>;
};

export type ServiceUsageRecord = {
  /** When service was used */
  timestamp: number;
  /** Service ID */
  serviceId: SharedServiceId;
  /** Company that used the service */
  companyId: CompanyId;
  /** Agent that invoked the service */
  requestingAgentId: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Cost incurred */
  cost: number;
  /** Request metadata */
  metadata?: Record<string, unknown>;
};

/**
 * SharedServiceRegistry manages agents that are shared across companies.
 */
export class SharedServiceRegistry {
  private services: Map<SharedServiceId, SharedService>;
  private usageRecords: ServiceUsageRecord[];
  private activeRequests: Map<SharedServiceId, number>;

  constructor() {
    this.services = new Map();
    this.usageRecords = [];
    this.activeRequests = new Map();
  }

  /**
   * Register a shared service.
   */
  registerService(service: Omit<SharedService, "id">): SharedService {
    const id = this.generateServiceId(service.name);

    const fullService: SharedService = {
      id,
      ...service,
    };

    this.services.set(id, fullService);
    return fullService;
  }

  /**
   * Get a service by ID.
   */
  getService(serviceId: SharedServiceId): SharedService | undefined {
    return this.services.get(serviceId);
  }

  /**
   * List all services (optionally filtered by company access).
   */
  listServices(companyId?: CompanyId): SharedService[] {
    const services = Array.from(this.services.values());

    if (companyId) {
      return services.filter((s) => this.canCompanyUseService(companyId, s.id));
    }

    return services;
  }

  /**
   * Check if a company can use a service.
   */
  canCompanyUseService(companyId: CompanyId, serviceId: SharedServiceId): boolean {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    if (!service.available) {
      return false;
    }

    // If allowedCompanyIds is empty, service is available to all
    if (service.allowedCompanyIds.length === 0) {
      return true;
    }

    return service.allowedCompanyIds.includes(companyId);
  }

  /**
   * Grant access to a company.
   */
  grantAccess(serviceId: SharedServiceId, companyId: CompanyId): void {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    if (!service.allowedCompanyIds.includes(companyId)) {
      service.allowedCompanyIds.push(companyId);
      this.services.set(serviceId, service);
    }
  }

  /**
   * Revoke access from a company.
   */
  revokeAccess(serviceId: SharedServiceId, companyId: CompanyId): void {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    const index = service.allowedCompanyIds.indexOf(companyId);
    if (index !== -1) {
      service.allowedCompanyIds.splice(index, 1);
      this.services.set(serviceId, service);
    }
  }

  /**
   * Update service configuration.
   */
  updateService(
    serviceId: SharedServiceId,
    updates: Partial<Omit<SharedService, "id">>,
  ): SharedService {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    const updated = {
      ...service,
      ...updates,
    };

    this.services.set(serviceId, updated);
    return updated;
  }

  /**
   * Set service availability.
   */
  setServiceAvailable(serviceId: SharedServiceId, available: boolean): void {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    service.available = available;
    this.services.set(serviceId, service);
  }

  /**
   * Check if service has capacity for a new request.
   */
  hasCapacity(serviceId: SharedServiceId): boolean {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    if (!service.available) {
      return false;
    }

    // No limit set = unlimited capacity
    if (!service.maxConcurrentRequests) {
      return true;
    }

    const activeCount = this.activeRequests.get(serviceId) ?? 0;
    return activeCount < service.maxConcurrentRequests;
  }

  /**
   * Acquire a service request slot.
   */
  acquireRequest(serviceId: SharedServiceId, companyId: CompanyId): { success: boolean; reason?: string } {
    if (!this.canCompanyUseService(companyId, serviceId)) {
      return { success: false, reason: "Company not authorized" };
    }

    if (!this.hasCapacity(serviceId)) {
      return { success: false, reason: "Service at capacity" };
    }

    const currentCount = this.activeRequests.get(serviceId) ?? 0;
    this.activeRequests.set(serviceId, currentCount + 1);

    return { success: true };
  }

  /**
   * Release a service request slot.
   */
  releaseRequest(serviceId: SharedServiceId): void {
    const currentCount = this.activeRequests.get(serviceId) ?? 0;
    if (currentCount > 0) {
      this.activeRequests.set(serviceId, currentCount - 1);
    }
  }

  /**
   * Record service usage.
   */
  recordUsage(
    serviceId: SharedServiceId,
    companyId: CompanyId,
    requestingAgentId: string,
    durationMs: number,
    metadata?: Record<string, unknown>,
  ): ServiceUsageRecord {
    const service = this.services.get(serviceId);
    const cost = service?.costPerRequest ?? 0;

    const record: ServiceUsageRecord = {
      timestamp: Date.now(),
      serviceId,
      companyId,
      requestingAgentId,
      durationMs,
      cost,
      metadata,
    };

    this.usageRecords.push(record);
    return record;
  }

  /**
   * Get usage records for a company.
   */
  getCompanyUsage(
    companyId: CompanyId,
    startTime?: number,
    endTime?: number,
  ): ServiceUsageRecord[] {
    let records = this.usageRecords.filter((r) => r.companyId === companyId);

    if (startTime) {
      records = records.filter((r) => r.timestamp >= startTime);
    }

    if (endTime) {
      records = records.filter((r) => r.timestamp <= endTime);
    }

    return records;
  }

  /**
   * Get usage records for a service.
   */
  getServiceUsage(
    serviceId: SharedServiceId,
    startTime?: number,
    endTime?: number,
  ): ServiceUsageRecord[] {
    let records = this.usageRecords.filter((r) => r.serviceId === serviceId);

    if (startTime) {
      records = records.filter((r) => r.timestamp >= startTime);
    }

    if (endTime) {
      records = records.filter((r) => r.timestamp <= endTime);
    }

    return records;
  }

  /**
   * Get total cost for a company.
   */
  getCompanyCost(companyId: CompanyId, startTime?: number, endTime?: number): number {
    const records = this.getCompanyUsage(companyId, startTime, endTime);
    return records.reduce((sum, r) => sum + r.cost, 0);
  }

  /**
   * Get usage breakdown by service for a company.
   */
  getCompanyUsageBreakdown(
    companyId: CompanyId,
    startTime?: number,
    endTime?: number,
  ): Map<SharedServiceId, { requestCount: number; totalCost: number; totalDurationMs: number }> {
    const records = this.getCompanyUsage(companyId, startTime, endTime);
    const breakdown = new Map<SharedServiceId, { requestCount: number; totalCost: number; totalDurationMs: number }>();

    for (const record of records) {
      const current = breakdown.get(record.serviceId) ?? {
        requestCount: 0,
        totalCost: 0,
        totalDurationMs: 0,
      };

      breakdown.set(record.serviceId, {
        requestCount: current.requestCount + 1,
        totalCost: current.totalCost + record.cost,
        totalDurationMs: current.totalDurationMs + record.durationMs,
      });
    }

    return breakdown;
  }

  /**
   * Get most used services across all companies.
   */
  getMostUsedServices(limit = 10): Array<{ serviceId: SharedServiceId; requestCount: number; totalCost: number }> {
    const usage = new Map<SharedServiceId, { requestCount: number; totalCost: number }>();

    for (const record of this.usageRecords) {
      const current = usage.get(record.serviceId) ?? { requestCount: 0, totalCost: 0 };
      usage.set(record.serviceId, {
        requestCount: current.requestCount + 1,
        totalCost: current.totalCost + record.cost,
      });
    }

    return Array.from(usage.entries())
      .map(([serviceId, stats]) => ({ serviceId, ...stats }))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, limit);
  }

  /**
   * Get current active request counts.
   */
  getActiveRequestCounts(): Map<SharedServiceId, number> {
    return new Map(this.activeRequests);
  }

  /**
   * Unregister a service.
   */
  unregisterService(serviceId: SharedServiceId): void {
    this.services.delete(serviceId);
    this.activeRequests.delete(serviceId);
  }

  /**
   * Clear old usage records (data retention).
   */
  clearOldUsageRecords(beforeTimestamp: number): number {
    const beforeCount = this.usageRecords.length;
    this.usageRecords = this.usageRecords.filter((r) => r.timestamp >= beforeTimestamp);
    return beforeCount - this.usageRecords.length;
  }

  /**
   * Generate a unique service ID.
   */
  private generateServiceId(name: string): SharedServiceId {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `service-${normalized}-${Date.now()}`;
  }
}
