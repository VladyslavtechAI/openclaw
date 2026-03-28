import type { DashboardProvider } from "./DashboardProvider.js";

/**
 * Generic request/response types matching Node's http.IncomingMessage / http.ServerResponse
 * shape so we don't depend on Express/Fastify.
 */
interface RouteRequest {
  method?: string;
  url?: string;
}

interface RouteResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

interface Route {
  method: string;
  path: string;
  handler: (req: RouteRequest, res: RouteResponse) => void;
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  const search = url.slice(idx + 1);
  for (const pair of search.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      params[decodeURIComponent(pair)] = "";
    } else {
      params[decodeURIComponent(pair.slice(0, eqIdx))] = decodeURIComponent(
        pair.slice(eqIdx + 1),
      );
    }
  }
  return params;
}

function jsonResponse(
  res: RouteResponse,
  data: unknown,
  status = 200,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Creates an array of route definitions for the enterprise dashboard.
 * These can be mounted on any HTTP framework by matching method + path.
 */
export function createDashboardRoutes(provider: DashboardProvider): readonly Route[] {
  return [
    {
      method: "GET",
      path: "/enterprise/status",
      handler: (_req, res) => {
        jsonResponse(res, provider.getStatus());
      },
    },
    {
      method: "GET",
      path: "/enterprise/security/events",
      handler: (req, res) => {
        const query = parseQuery(req.url ?? "");
        const options: {
          limit?: number;
          offset?: number;
          severity?: string;
          module?: string;
        } = {};
        if (query["limit"]) options.limit = parseInt(query["limit"], 10);
        if (query["offset"]) options.offset = parseInt(query["offset"], 10);
        if (query["severity"]) options.severity = query["severity"];
        if (query["module"]) options.module = query["module"];
        jsonResponse(res, provider.getSecurityEvents(options));
      },
    },
    {
      method: "GET",
      path: "/enterprise/costs",
      handler: (_req, res) => {
        jsonResponse(res, provider.getCosts());
      },
    },
    {
      method: "GET",
      path: "/enterprise/compliance",
      handler: (_req, res) => {
        jsonResponse(res, provider.getCompliance());
      },
    },
    {
      method: "GET",
      path: "/enterprise/audit",
      handler: (req, res) => {
        const query = parseQuery(req.url ?? "");
        const options: { limit?: number; offset?: number } = {};
        if (query["limit"]) options.limit = parseInt(query["limit"], 10);
        if (query["offset"]) options.offset = parseInt(query["offset"], 10);
        jsonResponse(res, provider.getAuditLog(options));
      },
    },
  ];
}

/**
 * Simple request router that matches incoming requests against dashboard routes.
 * Returns true if a route was matched and handled.
 */
export function handleDashboardRequest(
  routes: readonly Route[],
  req: RouteRequest,
  res: RouteResponse,
): boolean {
  const method = (req.method ?? "GET").toUpperCase();
  const url = req.url ?? "/";
  const path = url.split("?")[0]!;

  for (const route of routes) {
    if (route.method === method && route.path === path) {
      route.handler(req, res);
      return true;
    }
  }
  return false;
}
