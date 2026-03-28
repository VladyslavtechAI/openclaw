// ─── Hook Decision ───────────────────────────────────────────────────────────

export type HookAction = "allow" | "block" | "modify";

export interface HookResult<T = unknown> {
  action: HookAction;
  /** Reason for blocking / modifying (logged in audit trail) */
  reason?: string;
  /** Modified payload when action === "modify" */
  modified?: T;
  /** Which security module produced this result */
  source?: string;
  /** Latency of the check in milliseconds */
  latencyMs?: number;
}

// ─── Agent Identity ──────────────────────────────────────────────────────────

export interface AgentIdentity {
  id: string;
  name: string;
  parentId?: string;
  roles: readonly string[];
  tier: "primary" | "sub" | "ephemeral";
}

// ─── Message Context ─────────────────────────────────────────────────────────

export interface MessageContext {
  agent: AgentIdentity;
  conversationId: string;
  turnIndex: number;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface MessagePayload {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
}

// ─── Tool Call Context ───────────────────────────────────────────────────────

export interface ToolCallContext {
  agent: AgentIdentity;
  conversationId: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface ToolCallPayload {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultPayload {
  toolName: string;
  result: unknown;
  durationMs: number;
  success: boolean;
}

// ─── Agent Spawn ─────────────────────────────────────────────────────────────

export interface AgentSpawnConfig {
  name: string;
  tools: readonly string[];
  allowedPaths: readonly string[];
  maxBudget?: number;
  tier: "sub" | "ephemeral";
  metadata: Record<string, unknown>;
}

// ─── File Access ─────────────────────────────────────────────────────────────

export interface FileAccessPayload {
  path: string;
  content?: string;
  operation: "read" | "write" | "execute" | "delete";
}

// ─── HTTP Request ────────────────────────────────────────────────────────────

export interface HttpRequestPayload {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}

// ─── Event Bus Types ─────────────────────────────────────────────────────────

export interface SecurityViolationEvent {
  module: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  agent: AgentIdentity;
  timestamp: number;
  payload?: unknown;
}

export interface CostThresholdEvent {
  agentId: string;
  currentCost: number;
  limit: number;
  percentUsed: number;
  timestamp: number;
}

export interface AnomalyEvent {
  type: string;
  score: number;
  description: string;
  agent: AgentIdentity;
  timestamp: number;
  details?: unknown;
}

export interface HealthEvent {
  module: string;
  status: "healthy" | "degraded" | "down";
  message?: string;
  timestamp: number;
}

export interface EventMap {
  "message:before": { message: MessagePayload; context: MessageContext };
  "message:after": { response: MessagePayload; context: MessageContext };
  "tool:before": { tool: ToolCallPayload; context: ToolCallContext };
  "tool:after": { result: ToolResultPayload; context: ToolCallContext };
  "agent:spawn": { parent: AgentIdentity; config: AgentSpawnConfig };
  "agent:message": {
    from: AgentIdentity;
    to: AgentIdentity;
    message: MessagePayload;
  };
  "file:read": { payload: FileAccessPayload; agent: AgentIdentity };
  "file:write": { payload: FileAccessPayload; agent: AgentIdentity };
  "http:request": { payload: HttpRequestPayload; agent: AgentIdentity };
  "security:violation": SecurityViolationEvent;
  "cost:threshold": CostThresholdEvent;
  "anomaly:detected": AnomalyEvent;
  "health:change": HealthEvent;
}
