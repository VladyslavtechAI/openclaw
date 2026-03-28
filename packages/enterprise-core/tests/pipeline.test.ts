import { describe, it, expect, beforeEach } from "vitest";
import { SecurityPipeline } from "../src/pipeline/SecurityPipeline.js";
import type { SecurityModules } from "../src/pipeline/SecurityPipeline.js";
import { ToolPipeline } from "../src/pipeline/ToolPipeline.js";
import type { ToolModules } from "../src/pipeline/ToolPipeline.js";
import { FilePipeline } from "../src/pipeline/FilePipeline.js";
import type { FileModules } from "../src/pipeline/FilePipeline.js";
import { AgentPipeline } from "../src/pipeline/AgentPipeline.js";
import type { AgentModules } from "../src/pipeline/AgentPipeline.js";
import { EventBus } from "../src/events/EventBus.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { Logger } from "../src/utils/logger.js";
import type {
  MessagePayload,
  MessageContext,
  AgentIdentity,
  AgentSpawnConfig,
  ToolCallPayload,
  ToolCallContext,
} from "../src/events/EventTypes.js";

const silentLogger = new Logger("test", { level: "error", sink: () => {} });

function agent(id = "a1"): AgentIdentity {
  return { id, name: "test", roles: ["user"], tier: "primary" };
}

function msgCtx(agentId = "a1"): MessageContext {
  return {
    agent: agent(agentId),
    conversationId: "c1",
    turnIndex: 0,
    timestamp: Date.now(),
    metadata: {},
  };
}

function toolCtx(agentId = "a1"): ToolCallContext {
  return {
    agent: agent(agentId),
    conversationId: "c1",
    timestamp: Date.now(),
    metadata: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SecurityPipeline
// ═══════════════════════════════════════════════════════════════════════════

describe("SecurityPipeline", () => {
  let eventBus: EventBus;
  let config: typeof DEFAULT_CONFIG;

  beforeEach(() => {
    eventBus = new EventBus(() => {});
    config = structuredClone(DEFAULT_CONFIG);
  });

  it("allows clean messages through all stages", async () => {
    const modules: SecurityModules = {
      injectionShield: { scan: async () => ({ safe: true }) },
      dlpEngine: {
        scan: async (c) => ({ hasPii: false, findings: [], redacted: c }),
      },
      contentSafety: {
        check: async () => ({ safe: true, score: 0.1 }),
      },
      exfilGuard: { check: async () => ({ safe: true }) },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    const msg: MessagePayload = { role: "user", content: "Hello" };
    const result = await pipeline.process(msg, msgCtx());

    expect(result.action).toBe("allow");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("blocks at injection shield (first stage)", async () => {
    const modules: SecurityModules = {
      injectionShield: {
        scan: async () => ({ safe: false, reason: "injection" }),
      },
      dlpEngine: {
        scan: async () => {
          throw new Error("should not reach DLP");
        },
      },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { role: "user", content: "hack" },
      msgCtx(),
    );
    expect(result.action).toBe("block");
    expect(result.source).toBe("InjectionShield");
  });

  it("modifies message when DLP redacts PII", async () => {
    const modules: SecurityModules = {
      dlpEngine: {
        scan: async () => ({
          hasPii: true,
          findings: [{ type: "ssn", value: "123-45-6789", offset: 4 }],
          redacted: "SSN [REDACTED]",
        }),
      },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { role: "user", content: "SSN 123-45-6789" },
      msgCtx(),
    );
    expect(result.action).toBe("modify");
    expect((result.modified as MessagePayload).content).toBe("SSN [REDACTED]");
  });

  it("blocks at content safety (third stage)", async () => {
    const modules: SecurityModules = {
      contentSafety: {
        check: async () => ({
          safe: false,
          score: 0.95,
          category: "harmful",
        }),
      },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { role: "user", content: "bad content" },
      msgCtx(),
    );
    expect(result.action).toBe("block");
    expect(result.source).toBe("ContentSafety");
  });

  it("blocks input exceeding max length", async () => {
    config.security.injectionShield.maxInputLength = 10;
    const modules: SecurityModules = {
      injectionShield: { scan: async () => ({ safe: true }) },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { role: "user", content: "a".repeat(100) },
      msgCtx(),
    );
    expect(result.action).toBe("block");
    expect(result.reason).toContain("maximum");
  });

  it("emits security:violation on block", async () => {
    const violations: unknown[] = [];
    eventBus.on("security:violation", (v) => {
      violations.push(v);
    });

    const modules: SecurityModules = {
      exfilGuard: {
        check: async () => ({ safe: false, reason: "data leak" }),
      },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    await pipeline.process({ role: "user", content: "leak" }, msgCtx());

    expect(violations.length).toBe(1);
  });

  it("tracks metrics", async () => {
    const modules: SecurityModules = {};
    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);

    await pipeline.process({ role: "user", content: "a" }, msgCtx());
    await pipeline.process({ role: "user", content: "b" }, msgCtx());

    const m = pipeline.getMetrics();
    expect(m.processed).toBe(2);
    expect(m.blocked).toBe(0);
    expect(m.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails open on module error", async () => {
    const modules: SecurityModules = {
      injectionShield: {
        scan: async () => {
          throw new Error("module crash");
        },
      },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { role: "user", content: "test" },
      msgCtx(),
    );
    expect(result.action).toBe("allow");
    expect(result.reason).toBe("pipeline-error-fail-open");
  });

  it("skips disabled modules", async () => {
    config.security.injectionShield.enabled = false;
    config.security.dlp.enabled = false;
    config.security.contentSafety.enabled = false;
    config.security.exfilGuard.enabled = false;

    const modules: SecurityModules = {
      injectionShield: {
        scan: async () => {
          throw new Error("should not be called");
        },
      },
    };

    const pipeline = new SecurityPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { role: "user", content: "test" },
      msgCtx(),
    );
    expect(result.action).toBe("allow");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ToolPipeline
// ═══════════════════════════════════════════════════════════════════════════

describe("ToolPipeline", () => {
  let eventBus: EventBus;
  let config: typeof DEFAULT_CONFIG;

  beforeEach(() => {
    eventBus = new EventBus(() => {});
    config = structuredClone(DEFAULT_CONFIG);
  });

  it("allows tool calls with no modules", async () => {
    const pipeline = new ToolPipeline(config, {}, eventBus, silentLogger);
    const result = await pipeline.process(
      { toolName: "read_file", args: { path: "/tmp/x" } },
      toolCtx(),
    );
    expect(result.action).toBe("allow");
  });

  it("blocks when subagent scope denies tool", async () => {
    const modules: ToolModules = {
      subagentScope: {
        checkToolAccess: async () => ({
          allowed: false,
          reason: "not permitted",
        }),
      },
    };

    const pipeline = new ToolPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { toolName: "execute_code", args: {} },
      toolCtx(),
    );
    expect(result.action).toBe("block");
    expect(result.source).toBe("SubagentScope");
  });

  it("blocks filesystem tool when path denied", async () => {
    const modules: ToolModules = {
      filesystemPolicy: {
        checkAccess: async () => ({
          allowed: false,
          reason: "path blocked",
        }),
      },
    };

    const pipeline = new ToolPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { toolName: "read_file", args: { path: "/etc/shadow" } },
      toolCtx(),
    );
    expect(result.action).toBe("block");
    expect(result.source).toBe("FilesystemPolicy");
  });

  it("blocks network tool when URL denied", async () => {
    const modules: ToolModules = {
      networkPolicy: {
        checkUrl: async () => ({
          allowed: false,
          reason: "domain blocked",
        }),
      },
    };

    const pipeline = new ToolPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { toolName: "web_fetch", args: { url: "http://evil.com" } },
      toolCtx(),
    );
    expect(result.action).toBe("block");
    expect(result.source).toBe("NetworkPolicy");
  });

  it("does not check filesystem for non-fs tools", async () => {
    const modules: ToolModules = {
      filesystemPolicy: {
        checkAccess: async () => {
          throw new Error("should not be called");
        },
      },
    };

    const pipeline = new ToolPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { toolName: "some_other_tool", args: {} },
      toolCtx(),
    );
    expect(result.action).toBe("allow");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FilePipeline
// ═══════════════════════════════════════════════════════════════════════════

describe("FilePipeline", () => {
  let eventBus: EventBus;
  let config: typeof DEFAULT_CONFIG;

  beforeEach(() => {
    eventBus = new EventBus(() => {});
    config = structuredClone(DEFAULT_CONFIG);
  });

  it("allows reads with no modules", async () => {
    const pipeline = new FilePipeline(config, {}, eventBus, silentLogger);
    const result = await pipeline.process(
      { path: "/tmp/x", operation: "read" },
      agent(),
    );
    expect(result.action).toBe("allow");
  });

  it("blocks when filesystem policy denies", async () => {
    const modules: FileModules = {
      filesystemPolicy: {
        checkAccess: async () => ({ allowed: false, reason: "denied" }),
      },
    };

    const pipeline = new FilePipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { path: "/etc/passwd", operation: "read" },
      agent(),
    );
    expect(result.action).toBe("block");
  });

  it("blocks when backdoor scanner finds issue", async () => {
    const modules: FileModules = {
      backdoorScanner: {
        verifyIntegrity: async () => ({
          clean: false,
          reason: "hash mismatch",
        }),
      },
    };

    const pipeline = new FilePipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(
      { path: "/app/main.js", content: "evil()", operation: "write" },
      agent(),
    );
    expect(result.action).toBe("block");
    expect(result.source).toBe("BackdoorScanner");
  });

  it("calls audit logger on allow", async () => {
    const logged: unknown[] = [];
    const modules: FileModules = {
      auditLogger: {
        log: async (entry) => {
          logged.push(entry);
        },
      },
    };

    const pipeline = new FilePipeline(config, modules, eventBus, silentLogger);
    await pipeline.process({ path: "/tmp/x", operation: "read" }, agent());
    expect(logged.length).toBe(1);
  });

  it("calls audit logger on block", async () => {
    const logged: unknown[] = [];
    const modules: FileModules = {
      filesystemPolicy: {
        checkAccess: async () => ({ allowed: false, reason: "no" }),
      },
      auditLogger: {
        log: async (entry) => {
          logged.push(entry);
        },
      },
    };

    const pipeline = new FilePipeline(config, modules, eventBus, silentLogger);
    await pipeline.process({ path: "/etc/x", operation: "write" }, agent());
    expect(logged.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AgentPipeline
// ═══════════════════════════════════════════════════════════════════════════

describe("AgentPipeline", () => {
  let eventBus: EventBus;
  let config: typeof DEFAULT_CONFIG;

  beforeEach(() => {
    eventBus = new EventBus(() => {});
    config = structuredClone(DEFAULT_CONFIG);
  });

  const childConfig: AgentSpawnConfig = {
    name: "worker",
    tools: ["read_file", "web_fetch"],
    allowedPaths: ["/tmp"],
    tier: "sub",
    metadata: {},
  };

  it("allows spawn with no modules", async () => {
    const pipeline = new AgentPipeline(config, {}, eventBus, silentLogger);
    const result = await pipeline.process(agent(), childConfig);
    expect(result.action).toBe("allow");
  });

  it("blocks when hierarchy exceeded", async () => {
    const modules: AgentModules = {
      agentHierarchy: {
        validateSpawn: async () => ({
          allowed: false,
          depth: 6,
          reason: "too deep",
        }),
      },
    };

    const pipeline = new AgentPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(agent(), childConfig);
    expect(result.action).toBe("block");
    expect(result.source).toBe("AgentHierarchy");
  });

  it("modifies config when scope restricts tools", async () => {
    const modules: AgentModules = {
      subagentScope: {
        validateSpawnConfig: async () => ({
          allowed: true,
          restrictedTools: ["web_fetch"],
        }),
      },
    };

    const pipeline = new AgentPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(agent(), childConfig);
    expect(result.action).toBe("modify");
    const modified = result.modified as AgentSpawnConfig;
    expect(modified.tools).toEqual(["read_file"]);
  });

  it("blocks when budget exceeded", async () => {
    const modules: AgentModules = {
      costGovernor: {
        checkBudget: async () => ({
          allowed: false,
          remaining: 0,
          reason: "over budget",
        }),
      },
    };

    const pipeline = new AgentPipeline(config, modules, eventBus, silentLogger);
    const result = await pipeline.process(agent(), childConfig);
    expect(result.action).toBe("block");
    expect(result.source).toBe("CostGovernor");
  });

  it("emits cost:threshold event when near limit", async () => {
    const events: unknown[] = [];
    eventBus.on("cost:threshold", (e) => events.push(e));

    const modules: AgentModules = {
      costGovernor: {
        checkBudget: async () => ({
          allowed: true,
          remaining: 5,
        }),
      },
    };

    config.infrastructure.costGovernor.alertAtPercent = 50;
    config.infrastructure.costGovernor.monthlyBudgetUsd = 100;
    config.infrastructure.costGovernor.perAgentLimitUsd = 90;

    const pipeline = new AgentPipeline(config, modules, eventBus, silentLogger);
    await pipeline.process(agent(), childConfig);

    expect(events.length).toBe(1);
  });
});
