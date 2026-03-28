/**
 * Cross-Company Bus: Secure message routing between companies.
 * Features: approval-gated data sharing, request/response protocol, full audit trail.
 */

import crypto from "node:crypto";
import type { CompanyId } from "./group-manager.js";

export type MessageId = string;

export type CrossCompanyMessage = {
  /** Unique message ID */
  id: MessageId;
  /** Source company */
  sourceCompanyId: CompanyId;
  /** Target company */
  targetCompanyId: CompanyId;
  /** Message type */
  type: "request" | "response" | "notification";
  /** Message payload */
  payload: unknown;
  /** Response to this message ID (if type=response) */
  replyToMessageId?: MessageId;
  /** Message status */
  status: "pending" | "approved" | "rejected" | "delivered" | "failed";
  /** Whether approval is required */
  requiresApproval: boolean;
  /** Who approved (if approved) */
  approvedBy?: string;
  /** When created */
  createdAt: number;
  /** When approved/rejected/delivered */
  processedAt?: number;
  /** Audit trail */
  auditLog: AuditEntry[];
  /** Message metadata */
  metadata?: Record<string, unknown>;
};

export type AuditEntry = {
  timestamp: number;
  action: string;
  actor?: string;
  details?: string;
};

export type MessageFilter = {
  sourceCompanyId?: CompanyId;
  targetCompanyId?: CompanyId;
  status?: CrossCompanyMessage["status"];
  type?: CrossCompanyMessage["type"];
  startTime?: number;
  endTime?: number;
};

/**
 * CrossCompanyBus manages secure communication between companies.
 */
export class CrossCompanyBus {
  private messages: Map<MessageId, CrossCompanyMessage>;
  private pendingApprovals: Map<CompanyId, MessageId[]>;

  constructor() {
    this.messages = new Map();
    this.pendingApprovals = new Map();
  }

  /**
   * Send a message from one company to another.
   */
  sendMessage(
    sourceCompanyId: CompanyId,
    targetCompanyId: CompanyId,
    type: CrossCompanyMessage["type"],
    payload: unknown,
    options?: {
      requiresApproval?: boolean;
      replyToMessageId?: MessageId;
      metadata?: Record<string, unknown>;
    },
  ): CrossCompanyMessage {
    if (sourceCompanyId === targetCompanyId) {
      throw new Error("Cannot send message to same company");
    }

    const message: CrossCompanyMessage = {
      id: this.generateMessageId(),
      sourceCompanyId,
      targetCompanyId,
      type,
      payload,
      replyToMessageId: options?.replyToMessageId,
      status: options?.requiresApproval !== false ? "pending" : "delivered",
      requiresApproval: options?.requiresApproval !== false,
      createdAt: Date.now(),
      auditLog: [
        {
          timestamp: Date.now(),
          action: "message_created",
          details: `${type} from ${sourceCompanyId} to ${targetCompanyId}`,
        },
      ],
      metadata: options?.metadata,
    };

    this.messages.set(message.id, message);

    if (message.requiresApproval) {
      this.addPendingApproval(targetCompanyId, message.id);
    }

    return message;
  }

  /**
   * Get a message by ID.
   */
  getMessage(messageId: MessageId): CrossCompanyMessage | undefined {
    return this.messages.get(messageId);
  }

  /**
   * List messages (with optional filtering).
   */
  listMessages(filter?: MessageFilter): CrossCompanyMessage[] {
    let messages = Array.from(this.messages.values());

    if (filter) {
      if (filter.sourceCompanyId) {
        messages = messages.filter((m) => m.sourceCompanyId === filter.sourceCompanyId);
      }

      if (filter.targetCompanyId) {
        messages = messages.filter((m) => m.targetCompanyId === filter.targetCompanyId);
      }

      if (filter.status) {
        messages = messages.filter((m) => m.status === filter.status);
      }

      if (filter.type) {
        messages = messages.filter((m) => m.type === filter.type);
      }

      if (filter.startTime) {
        messages = messages.filter((m) => m.createdAt >= filter.startTime!);
      }

      if (filter.endTime) {
        messages = messages.filter((m) => m.createdAt <= filter.endTime!);
      }
    }

    return messages.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get pending approvals for a company.
   */
  getPendingApprovals(companyId: CompanyId): CrossCompanyMessage[] {
    const messageIds = this.pendingApprovals.get(companyId) ?? [];
    return messageIds
      .map((id) => this.messages.get(id))
      .filter((m): m is CrossCompanyMessage => m !== undefined && m.status === "pending");
  }

  /**
   * Approve a message.
   */
  approveMessage(messageId: MessageId, approverId: string): CrossCompanyMessage {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    if (message.status !== "pending") {
      throw new Error(`Message ${messageId} is not pending approval`);
    }

    message.status = "approved";
    message.approvedBy = approverId;
    message.processedAt = Date.now();
    message.auditLog.push({
      timestamp: Date.now(),
      action: "message_approved",
      actor: approverId,
    });

    this.removePendingApproval(message.targetCompanyId, messageId);
    this.messages.set(messageId, message);

    return message;
  }

  /**
   * Reject a message.
   */
  rejectMessage(messageId: MessageId, rejecterId: string, reason?: string): CrossCompanyMessage {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    if (message.status !== "pending") {
      throw new Error(`Message ${messageId} is not pending approval`);
    }

    message.status = "rejected";
    message.processedAt = Date.now();
    message.auditLog.push({
      timestamp: Date.now(),
      action: "message_rejected",
      actor: rejecterId,
      details: reason,
    });

    this.removePendingApproval(message.targetCompanyId, messageId);
    this.messages.set(messageId, message);

    return message;
  }

  /**
   * Mark message as delivered.
   */
  markDelivered(messageId: MessageId): CrossCompanyMessage {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    if (message.status === "pending") {
      throw new Error(`Message ${messageId} requires approval first`);
    }

    message.status = "delivered";
    message.processedAt = Date.now();
    message.auditLog.push({
      timestamp: Date.now(),
      action: "message_delivered",
    });

    this.messages.set(messageId, message);
    return message;
  }

  /**
   * Mark message as failed.
   */
  markFailed(messageId: MessageId, reason: string): CrossCompanyMessage {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    message.status = "failed";
    message.processedAt = Date.now();
    message.auditLog.push({
      timestamp: Date.now(),
      action: "message_failed",
      details: reason,
    });

    this.messages.set(messageId, message);
    return message;
  }

  /**
   * Send a response to a message.
   */
  sendResponse(
    originalMessageId: MessageId,
    responsePayload: unknown,
    metadata?: Record<string, unknown>,
  ): CrossCompanyMessage {
    const originalMessage = this.messages.get(originalMessageId);
    if (!originalMessage) {
      throw new Error(`Original message ${originalMessageId} not found`);
    }

    // Response goes back to source company
    return this.sendMessage(
      originalMessage.targetCompanyId,
      originalMessage.sourceCompanyId,
      "response",
      responsePayload,
      {
        requiresApproval: false, // Responses typically don't need approval
        replyToMessageId: originalMessageId,
        metadata,
      },
    );
  }

  /**
   * Get conversation thread (message + all responses).
   */
  getConversationThread(messageId: MessageId): CrossCompanyMessage[] {
    const rootMessage = this.messages.get(messageId);
    if (!rootMessage) {
      return [];
    }

    const thread: CrossCompanyMessage[] = [rootMessage];

    // Find all responses
    for (const message of this.messages.values()) {
      if (message.replyToMessageId === messageId) {
        thread.push(message);

        // Recursively get responses to responses
        const subThread = this.getConversationThread(message.id);
        thread.push(...subThread.slice(1)); // Skip the message itself
      }
    }

    return thread.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get audit trail for a company (all messages involving that company).
   */
  getCompanyAuditTrail(companyId: CompanyId, startTime?: number, endTime?: number): AuditEntry[] {
    const messages = this.listMessages({
      startTime,
      endTime,
    }).filter((m) => m.sourceCompanyId === companyId || m.targetCompanyId === companyId);

    const allEntries: (AuditEntry & { messageId: string })[] = [];

    for (const message of messages) {
      for (const entry of message.auditLog) {
        allEntries.push({
          ...entry,
          messageId: message.id,
        });
      }
    }

    return allEntries.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get message statistics for a company.
   */
  getCompanyStats(
    companyId: CompanyId,
    startTime?: number,
    endTime?: number,
  ): {
    sentCount: number;
    receivedCount: number;
    pendingApprovalCount: number;
    approvedCount: number;
    rejectedCount: number;
  } {
    const messages = this.listMessages({ startTime, endTime });

    const sent = messages.filter((m) => m.sourceCompanyId === companyId);
    const received = messages.filter((m) => m.targetCompanyId === companyId);

    return {
      sentCount: sent.length,
      receivedCount: received.length,
      pendingApprovalCount: received.filter((m) => m.status === "pending").length,
      approvedCount: received.filter((m) => m.status === "approved" || m.status === "delivered").length,
      rejectedCount: received.filter((m) => m.status === "rejected").length,
    };
  }

  /**
   * Clear old messages (data retention).
   */
  clearOldMessages(beforeTimestamp: number): number {
    const beforeCount = this.messages.size;

    for (const [messageId, message] of this.messages) {
      if (message.createdAt < beforeTimestamp) {
        this.messages.delete(messageId);
        this.removePendingApproval(message.targetCompanyId, messageId);
      }
    }

    return beforeCount - this.messages.size;
  }

  /**
   * Generate unique message ID.
   */
  private generateMessageId(): MessageId {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Add message to pending approvals list.
   */
  private addPendingApproval(companyId: CompanyId, messageId: MessageId): void {
    const pending = this.pendingApprovals.get(companyId) ?? [];
    pending.push(messageId);
    this.pendingApprovals.set(companyId, pending);
  }

  /**
   * Remove message from pending approvals list.
   */
  private removePendingApproval(companyId: CompanyId, messageId: MessageId): void {
    const pending = this.pendingApprovals.get(companyId) ?? [];
    const filtered = pending.filter((id) => id !== messageId);
    this.pendingApprovals.set(companyId, filtered);
  }
}
