// ─── Generic Middleware Types ────────────────────────────────────────────────
// Framework-agnostic request/response interfaces compatible with Express,
// Fastify, and plain Node.js HTTP servers.

/**
 * Generic incoming request interface.
 * Frameworks should map their native request objects to this shape.
 */
export interface IncomingRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
  // Enterprise extensions
  agentId?: string;
  apiKey?: string;
  jwtToken?: string;
}

/**
 * Generic outgoing response interface.
 * Frameworks should map their native response objects to this shape.
 */
export interface OutgoingResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
  json?(data: unknown): void;
}

/** Standard middleware next-function. Pass an Error to signal failure. */
export type NextFunction = (error?: Error) => void;

/** A single middleware unit. May be sync or async. */
export type Middleware = (
  req: IncomingRequest,
  res: OutgoingResponse,
  next: NextFunction,
) => void | Promise<void>;

// ─── Metrics ────────────────────────────────────────────────────────────────

/** Common metrics shape shared by all middleware modules. */
export interface MiddlewareMetrics {
  /** Total requests processed by this middleware */
  totalRequests: number;
  /** Total requests blocked / short-circuited */
  blockedRequests: number;
  /** Total internal errors caught */
  errors: number;
  /** Average processing latency in milliseconds */
  avgLatencyMs: number;
}
