/**
 * Corporate Approval Workflow
 * Multi-level approval chains, timeout/auto-escalation, audit trail.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type RequestStatus = "pending" | "approved" | "denied" | "escalated" | "timeout";

export interface ApprovalRequest {
  id: string;
  requester: string; // Agent ID
  action: string; // Action being requested
  description: string;
  data?: Record<string, unknown>;
  status: RequestStatus;
  requiredApprovals: number; // Number of approvals needed
  approvals: Approval[];
  approvalChain: string[]; // Ordered list of approvers
  currentApproverIndex: number;
  createdAt: number;
  updatedAt: number;
  timeoutAt?: number; // Auto-escalate if not approved by this time
  escalatedTo?: string; // Agent ID
  auditTrail: AuditEntry[];
}

export interface Approval {
  approver: string; // Agent ID
  decision: "approve" | "deny";
  reason?: string;
  timestamp: number;
}

export interface AuditEntry {
  timestamp: number;
  actor: string; // Agent ID
  action: "created" | "approved" | "denied" | "escalated" | "timeout";
  details?: string;
}

export interface ApprovalWorkflowConfig {
  storageDir: string;
  defaultTimeout?: number; // Default timeout in ms
  autoEscalate?: boolean; // Enable auto-escalation on timeout
}

export class ApprovalWorkflow {
  private readonly storageDir: string;
  private readonly requestsFile: string;
  private readonly defaultTimeout: number;
  private readonly autoEscalate: boolean;
  private requests: Map<string, ApprovalRequest> = new Map();

  constructor(config: ApprovalWorkflowConfig) {
    this.storageDir = config.storageDir;
    this.requestsFile = path.join(this.storageDir, "approval-requests.json");
    this.defaultTimeout = config.defaultTimeout ?? 24 * 60 * 60 * 1000; // 24 hours
    this.autoEscalate = config.autoEscalate ?? true;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.requestsFile)) {
      const data = JSON.parse(fs.readFileSync(this.requestsFile, "utf8"));
      this.requests = new Map(Object.entries(data));
    }
  }

  private save(): void {
    const data = Object.fromEntries(this.requests);
    fs.writeFileSync(this.requestsFile, JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * Create a new approval request.
   */
  createRequest(
    requester: string,
    action: string,
    description: string,
    approvalChain: string[],
    requiredApprovals?: number,
    data?: Record<string, unknown>,
    timeoutMs?: number,
  ): ApprovalRequest {
    if (approvalChain.length === 0) {
      throw new Error("Approval chain cannot be empty");
    }

    const now = Date.now();
    const timeout = timeoutMs ?? this.defaultTimeout;

    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      requester,
      action,
      description,
      data,
      status: "pending",
      requiredApprovals: requiredApprovals ?? 1,
      approvals: [],
      approvalChain,
      currentApproverIndex: 0,
      createdAt: now,
      updatedAt: now,
      timeoutAt: now + timeout,
      auditTrail: [
        {
          timestamp: now,
          actor: requester,
          action: "created",
          details: `Request for: ${action}`,
        },
      ],
    };

    this.requests.set(request.id, request);
    this.save();
    return request;
  }

  /**
   * Approve a request.
   */
  approve(requestId: string, approver: string, reason?: string): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Request ${requestId} is not pending (status: ${request.status})`);
    }

    // Check if approver is in the approval chain
    const currentApprover = request.approvalChain[request.currentApproverIndex];
    if (currentApprover !== approver) {
      throw new Error(
        `Approver ${approver} is not the current approver (expected: ${currentApprover})`,
      );
    }

    const now = Date.now();
    const approval: Approval = {
      approver,
      decision: "approve",
      reason,
      timestamp: now,
    };

    request.approvals.push(approval);
    request.updatedAt = now;

    request.auditTrail.push({
      timestamp: now,
      actor: approver,
      action: "approved",
      details: reason,
    });

    // Move to next approver or mark as approved
    request.currentApproverIndex++;
    if (request.approvals.length >= request.requiredApprovals) {
      request.status = "approved";
    } else if (request.currentApproverIndex >= request.approvalChain.length) {
      // All approvers exhausted but still need more approvals
      request.status = "approved";
    }

    this.save();
    return request;
  }

  /**
   * Deny a request.
   */
  deny(requestId: string, approver: string, reason?: string): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Request ${requestId} is not pending (status: ${request.status})`);
    }

    const currentApprover = request.approvalChain[request.currentApproverIndex];
    if (currentApprover !== approver) {
      throw new Error(
        `Approver ${approver} is not the current approver (expected: ${currentApprover})`,
      );
    }

    const now = Date.now();
    const approval: Approval = {
      approver,
      decision: "deny",
      reason,
      timestamp: now,
    };

    request.approvals.push(approval);
    request.status = "denied";
    request.updatedAt = now;

    request.auditTrail.push({
      timestamp: now,
      actor: approver,
      action: "denied",
      details: reason,
    });

    this.save();
    return request;
  }

  /**
   * Escalate a request to a higher authority.
   */
  escalate(requestId: string, escalateTo: string, reason?: string): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Request ${requestId} is not pending (status: ${request.status})`);
    }

    const now = Date.now();
    request.status = "escalated";
    request.escalatedTo = escalateTo;
    request.updatedAt = now;
    request.approvalChain.push(escalateTo);

    request.auditTrail.push({
      timestamp: now,
      actor: "system",
      action: "escalated",
      details: reason ?? `Escalated to ${escalateTo}`,
    });

    this.save();
    return request;
  }

  /**
   * Process timeouts for pending requests.
   * Returns escalated or timed-out requests.
   */
  processTimeouts(): ApprovalRequest[] {
    if (!this.autoEscalate) {
      return [];
    }

    const now = Date.now();
    const processed: ApprovalRequest[] = [];

    for (const request of this.requests.values()) {
      if (request.status !== "pending") continue;
      if (!request.timeoutAt || request.timeoutAt > now) continue;

      // Check if we can escalate
      const nextApproverIndex = request.currentApproverIndex + 1;
      if (nextApproverIndex < request.approvalChain.length) {
        // Escalate to next in chain
        const nextApprover = request.approvalChain[nextApproverIndex];
        request.status = "escalated";
        request.escalatedTo = nextApprover;
        request.currentApproverIndex = nextApproverIndex;
        request.updatedAt = now;

        request.auditTrail.push({
          timestamp: now,
          actor: "system",
          action: "escalated",
          details: `Auto-escalated due to timeout to ${nextApprover}`,
        });

        // Reset timeout
        request.timeoutAt = now + this.defaultTimeout;
      } else {
        // No one left to escalate to - mark as timeout
        request.status = "timeout";
        request.updatedAt = now;

        request.auditTrail.push({
          timestamp: now,
          actor: "system",
          action: "timeout",
          details: "Request timed out with no more approvers",
        });
      }

      processed.push(request);
    }

    if (processed.length > 0) {
      this.save();
    }

    return processed;
  }

  /**
   * Get a request by ID.
   */
  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Get all pending requests for an approver.
   */
  getPendingRequests(approver: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (req) =>
        req.status === "pending" &&
        req.approvalChain[req.currentApproverIndex] === approver,
    );
  }

  /**
   * Get requests by requester.
   */
  getRequestsByRequester(requester: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (req) => req.requester === requester,
    );
  }

  /**
   * Get requests by status.
   */
  getRequestsByStatus(status: RequestStatus): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((req) => req.status === status);
  }

  /**
   * Get the audit trail for a request.
   */
  getAuditTrail(requestId: string): AuditEntry[] {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }
    return request.auditTrail;
  }

  /**
   * Get all requests.
   */
  getAllRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values());
  }
}
