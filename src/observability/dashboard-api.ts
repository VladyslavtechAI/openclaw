/**
 * HTTP API for the observability dashboard.
 * Provides endpoints for events, metrics, alerts, and system health.
 * Uses the native Node.js HTTP server (no external framework dependency).
 */

import http from "node:http";
import type { EventLogger, EventFilter, TimeRange as EventTimeRange } from "./event-logger.js";
import type { AlertManager } from "./alert-manager.js";
import type { MetricsCollector, TimeRange as MetricTimeRange } from "./metrics-collector.js";

export type DashboardDeps = {
  eventLogger: EventLogger;
  alertManager: AlertManager;
  metricsCollector: MetricsCollector;
};

export type DashboardConfig = {
  port?: number;
  host?: string;
};

type RouteHandler = (
  req: http.IncomingMessage,
  params: Record<string, string>,
  query: URLSearchParams,
) => Promise<unknown>;

/**
 * Lightweight HTTP API server for the observability dashboard.
 */
export class DashboardApi {
  private deps: DashboardDeps;
  private server: http.Server | null = null;
  private routes: Map<string, Map<string, RouteHandler>> = new Map();

  constructor(deps: DashboardDeps) {
    this.deps = deps;
    this.registerRoutes();
  }

  /**
   * Start the HTTP server.
   */
  async start(config: DashboardConfig = {}): Promise<{ port: number; host: string }> {
    const port = config.port ?? 9100;
    const host = config.host ?? "127.0.0.1";

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(() => {
          if (!res.writableEnded) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        });
      });

      this.server.on("error", reject);
      this.server.listen(port, host, () => {
        resolve({ port, host });
      });
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  /**
   * Handle an incoming request (exposed for testing without starting the server).
   */
  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const query = url.searchParams;

    // Find matching route
    const methodRoutes = this.routes.get(req.method ?? "GET");
    if (!methodRoutes) {
      this.sendJson(res, 404, { error: "Not found" });
      return;
    }

    for (const [pattern, handler] of methodRoutes) {
      const params = matchRoute(pattern, pathname);
      if (params !== null) {
        try {
          const result = await handler(req, params, query);
          this.sendJson(res, 200, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          this.sendJson(res, 500, { error: message });
        }
        return;
      }
    }

    this.sendJson(res, 404, { error: "Not found" });
  }

  private registerRoutes(): void {
    this.get("/api/events", async (_req, _params, query) => {
      const filter: EventFilter = {};
      if (query.has("level")) filter.level = query.get("level") as EventFilter["level"];
      if (query.has("category")) filter.category = query.get("category") as EventFilter["category"];
      if (query.has("machine")) filter.machine = query.get("machine")!;
      if (query.has("agentId")) filter.agentId = query.get("agentId")!;
      if (query.has("event")) filter.event = query.get("event")!;
      if (query.has("since")) filter.since = query.get("since")!;
      if (query.has("until")) filter.until = query.get("until")!;
      if (query.has("limit")) filter.limit = parseInt(query.get("limit")!, 10);

      return { events: this.deps.eventLogger.query(filter) };
    });

    this.get("/api/metrics", async (_req, _params, query) => {
      const range: MetricTimeRange = {
        start: query.get("start") ?? new Date(Date.now() - 3_600_000).toISOString(),
        end: query.get("end") ?? new Date().toISOString(),
      };

      const name = query.get("name");
      if (name) {
        const resolution = query.get("resolution") ?? "5m";
        return { timeSeries: this.deps.metricsCollector.getTimeSeries(name, range, resolution) };
      }

      return { summary: this.deps.metricsCollector.getSummary(range) };
    });

    this.get("/api/alerts", async () => {
      return {
        active: this.deps.alertManager.getActiveAlerts(),
        rules: this.deps.alertManager.getRules(),
      };
    });

    this.post("/api/alerts/:id/ack", async (_req, params) => {
      const success = this.deps.alertManager.acknowledge(params.id);
      return { success, alertId: params.id };
    });

    this.get("/api/agents", async (_req, _params, query) => {
      const range: EventTimeRange = {
        start: query.get("start") ?? new Date(Date.now() - 3_600_000).toISOString(),
        end: query.get("end") ?? new Date().toISOString(),
      };

      const events = this.deps.eventLogger.query({
        categories: ["agent"],
        since: range.start,
        until: range.end,
      });

      // Group events by agentId to build status
      const agents = new Map<string, { lastSeen: string; machine: string; events: number; errors: number }>();
      for (const event of events) {
        if (!event.agentId) continue;
        const existing = agents.get(event.agentId) ?? { lastSeen: event.timestamp, machine: event.machine, events: 0, errors: 0 };
        existing.events++;
        if (event.level === "error" || event.level === "critical") existing.errors++;
        if (event.timestamp > existing.lastSeen) {
          existing.lastSeen = event.timestamp;
          existing.machine = event.machine;
        }
        agents.set(event.agentId, existing);
      }

      return {
        agents: [...agents.entries()].map(([agentId, info]) => ({ agentId, ...info })),
      };
    });

    this.get("/api/health", async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3_600_000);
      const range: EventTimeRange = { start: oneHourAgo.toISOString(), end: now.toISOString() };

      const metrics = this.deps.eventLogger.getMetrics(range);
      const activeAlerts = this.deps.alertManager.getActiveAlerts();

      const status =
        activeAlerts.some((a) => a.severity === "critical")
          ? "critical"
          : activeAlerts.some((a) => a.severity === "warning")
            ? "degraded"
            : "healthy";

      return {
        status,
        timestamp: now.toISOString(),
        lastHour: {
          totalEvents: metrics.totalEvents,
          errorRate: metrics.errorRate,
          byLevel: metrics.byLevel,
        },
        activeAlerts: activeAlerts.length,
      };
    });
  }

  private get(pattern: string, handler: RouteHandler): void {
    let methodRoutes = this.routes.get("GET");
    if (!methodRoutes) {
      methodRoutes = new Map();
      this.routes.set("GET", methodRoutes);
    }
    methodRoutes.set(pattern, handler);
  }

  private post(pattern: string, handler: RouteHandler): void {
    let methodRoutes = this.routes.get("POST");
    if (!methodRoutes) {
      methodRoutes = new Map();
      this.routes.set("POST", methodRoutes);
    }
    methodRoutes.set(pattern, handler);
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}

/**
 * Match a route pattern like "/api/alerts/:id/ack" against a pathname.
 * Returns params map or null if no match.
 */
function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}
