import { describe, it, expect } from "vitest";
import { RequestValidator } from "../src/middleware/RequestValidator.js";
import { RateLimiter } from "../src/middleware/RateLimiter.js";
import { AuditMiddleware } from "../src/middleware/AuditMiddleware.js";
import { AuthEnhancer } from "../src/middleware/AuthEnhancer.js";
import type { IncomingRequest, OutgoingResponse } from "../src/middleware/types.js";
import { Logger } from "../src/utils/logger.js";

const silentLogger = new Logger("test", { level: "error", sink: () => {} });

function makeReq(overrides?: Partial<IncomingRequest>): IncomingRequest {
  return {
    method: "POST",
    url: "/api/chat",
    headers: { "content-type": "application/json" },
    body: { message: "hello" },
    ip: "127.0.0.1",
    ...overrides,
  };
}

function makeRes(): OutgoingResponse & {
  _statusCode: number;
  _headers: Record<string, string>;
  _body: string | undefined;
  _ended: boolean;
} {
  const res = {
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: undefined as string | undefined,
    _ended: false,
    get statusCode() {
      return res._statusCode;
    },
    set statusCode(code: number) {
      res._statusCode = code;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
    },
    end(body?: string) {
      res._body = body;
      res._ended = true;
    },
  };
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
// RequestValidator
// ═══════════════════════════════════════════════════════════════════════════

describe("RequestValidator", () => {
  it("passes valid requests", () => {
    const validator = new RequestValidator({ maxBodyBytes: 1_000_000 }, silentLogger);
    const res = makeRes();
    let nextCalled = false;

    validator.middleware(makeReq(), res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res._ended).toBe(false);
  });

  it("rejects oversized bodies", () => {
    const validator = new RequestValidator({ maxBodyBytes: 10 }, silentLogger);
    const res = makeRes();
    let nextCalled = false;

    validator.middleware(
      makeReq({ body: "x".repeat(100) }),
      res,
      () => {
        nextCalled = true;
      },
    );
    expect(nextCalled).toBe(false);
    expect(res._statusCode).toBe(413);
  });

  it("tracks metrics", () => {
    const validator = new RequestValidator({ maxBodyBytes: 1_000_000 }, silentLogger);
    const res = makeRes();
    validator.middleware(makeReq(), res, () => {});
    const metrics = validator.getMetrics();
    expect(metrics.totalRequests).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RateLimiter
// ═══════════════════════════════════════════════════════════════════════════

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = new RateLimiter(
      { enabled: true, windowMs: 60_000, maxRequests: 10 },
      silentLogger,
    );
    const res = makeRes();
    let nextCalled = false;

    limiter.middleware(makeReq({ agentId: "a1" }), res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    limiter.destroy();
  });

  it("blocks requests exceeding limit", () => {
    const limiter = new RateLimiter(
      { enabled: true, windowMs: 60_000, maxRequests: 2 },
      silentLogger,
    );

    for (let i = 0; i < 2; i++) {
      const res = makeRes();
      limiter.middleware(makeReq({ agentId: "a1" }), res, () => {});
    }

    const res = makeRes();
    let nextCalled = false;
    limiter.middleware(makeReq({ agentId: "a1" }), res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res._statusCode).toBe(429);
    limiter.destroy();
  });

  it("tracks different agents separately", () => {
    const limiter = new RateLimiter(
      { enabled: true, windowMs: 60_000, maxRequests: 1 },
      silentLogger,
    );

    const res1 = makeRes();
    limiter.middleware(makeReq({ agentId: "a1" }), res1, () => {});
    expect(res1._ended).toBe(false);

    const res2 = makeRes();
    let nextCalled = false;
    limiter.middleware(makeReq({ agentId: "a2" }), res2, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    limiter.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AuditMiddleware
// ═══════════════════════════════════════════════════════════════════════════

describe("AuditMiddleware", () => {
  it("logs requests and calls next", () => {
    const audit = new AuditMiddleware({ logRequests: false }, silentLogger);
    const res = makeRes();
    let nextCalled = false;

    audit.middleware(makeReq({ agentId: "a1" }), res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    // The audit records on res.end(), trigger it
    res.end("done");

    const entries = audit.getRecentEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.agentId).toBe("a1");
  });

  it("limits stored entries", () => {
    const audit = new AuditMiddleware({ maxBufferSize: 2, logRequests: false }, silentLogger);
    const next = () => {};

    for (let i = 1; i <= 3; i++) {
      const res = makeRes();
      audit.middleware(makeReq({ agentId: `a${i}` }), res, next);
      res.end("done");
    }

    const entries = audit.getRecentEntries();
    expect(entries.length).toBe(2);
    // Newest first
    expect(entries[0]!.agentId).toBe("a3");
    expect(entries[1]!.agentId).toBe("a2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AuthEnhancer
// ═══════════════════════════════════════════════════════════════════════════

describe("AuthEnhancer", () => {
  it("passes when auth disabled", () => {
    const auth = new AuthEnhancer(
      { enabled: false, method: "apiKey", jwtSecret: "" },
      undefined,
      silentLogger,
    );
    const res = makeRes();
    let nextCalled = false;

    auth.middleware(makeReq(), res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("blocks when no API key provided", () => {
    const auth = new AuthEnhancer(
      { enabled: true, method: "apiKey", jwtSecret: "" },
      undefined,
      silentLogger,
    );
    auth.addApiKey("key-123", "agent-1");

    const res = makeRes();
    let nextCalled = false;
    auth.middleware(makeReq(), res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res._statusCode).toBe(401);
  });

  it("allows valid API key", () => {
    const auth = new AuthEnhancer(
      { enabled: true, method: "apiKey", jwtSecret: "" },
      undefined,
      silentLogger,
    );
    auth.addApiKey("key-123", "agent-1");

    const res = makeRes();
    let nextCalled = false;
    auth.middleware(
      makeReq({ apiKey: "key-123" }),
      res,
      () => {
        nextCalled = true;
      },
    );
    expect(nextCalled).toBe(true);
  });

  it("rejects invalid API key", () => {
    const auth = new AuthEnhancer(
      { enabled: true, method: "apiKey", jwtSecret: "" },
      undefined,
      silentLogger,
    );
    auth.addApiKey("key-123", "agent-1");

    const res = makeRes();
    let nextCalled = false;
    auth.middleware(
      makeReq({ apiKey: "wrong-key" }),
      res,
      () => {
        nextCalled = true;
      },
    );
    expect(nextCalled).toBe(false);
    expect(res._statusCode).toBe(401);
  });

  it("removes API keys", () => {
    const auth = new AuthEnhancer(
      { enabled: true, method: "apiKey", jwtSecret: "" },
      undefined,
      silentLogger,
    );
    auth.addApiKey("key-123", "agent-1");
    const removed = auth.removeApiKey("key-123");
    expect(removed).toBe(true);
  });
});
