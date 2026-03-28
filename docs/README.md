# OpenClaw Enterprise Fork — Documentation

> **Fork Version:** 1.0.0
> **Base:** openclaw/openclaw @ main (Mar 27, 2026)
> **Branch:** `feature/security-phase0`
> **Tests:** 488 total (116 security + 372 infrastructure)

## What Is This Fork?

This is an enterprise-grade fork of [OpenClaw](https://github.com/openclaw/openclaw) that adds:

- **17 security modules** — prompt injection defense, SSRF protection, DLP, backdoor scanning, data exfiltration prevention, content safety, anomaly detection, tamper-evident audit logging
- **3 business solutions** — Retail Isolated (multi-tenant SaaS), Corporate Pyramidal (hierarchical org), Group of Companies (holding structure)
- **Agent hierarchy** — 3-tier permission system (admin/lead/worker) with credential isolation
- **Cost tracking** — per-agent JSONL billing with budget enforcement and auto-downgrade
- **Smart routing** — Claude Code load balancing across free instances with API fallback
- **Auto-healing** — automated fix for 8 common issue types from 37,668 real production errors

## Fork vs Upstream

| Feature | Upstream OpenClaw | This Fork |
|---------|-------------------|-----------|
| Security | Basic | 17 modules, defense-in-depth |
| Multi-tenancy | None | 3 isolation models |
| Agent hierarchy | Flat | 3-tier with permissions |
| Cost control | None | Per-agent budgets, auto-downgrade |
| Audit logging | None | Hash-chain tamper-evident JSONL |
| DLP | None | Credential/PII/financial detection |
| SSO | None | SAML + OIDC bridge |
| Compliance | None | SOC 2, HIPAA, GDPR evidence export |
| Auto-healing | None | 8 issue types with cooldown |
| Smart routing | None | Free-first with rate limit awareness |

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, module dependency graph, data flow diagrams |
| [API-REFERENCE.md](API-REFERENCE.md) | Complete API reference for all modules |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment guide: single machine, cluster, VPS, Docker |
| [SECURITY.md](SECURITY.md) | Security modules, threat model, compliance, pen test coverage |
| [SOLUTIONS.md](SOLUTIONS.md) | Three business solutions explained with setup guides |
| [MIGRATION.md](MIGRATION.md) | Migration from vanilla OpenClaw with rollback instructions |
| [CHANGELOG.md](CHANGELOG.md) | Full changelog from git history |

## Quick Start

```bash
# Clone the fork
git clone https://github.com/VladyslavtechAI/openclaw.git
cd openclaw
git checkout feature/security-phase0

# Install dependencies
pnpm install

# Run tests
npx vitest run src/security/ src/billing/ src/health/ src/agents/ src/routing/

# Build
npm run build
```

## Module Overview

### Security Layer (`src/security/`)

| Module | Class | Purpose |
|--------|-------|---------|
| injection-shield | `InjectionShield` | 3-layer prompt injection defense |
| network-policy | `NetworkPolicy` | SSRF protection, URL allowlist/blocklist |
| backdoor-scanner | `BackdoorScanner` | File integrity monitoring (SHA-256) |
| exfil-guard | `ExfilGuard` | Data exfiltration prevention |
| filesystem-policy | `FilesystemPolicy` | Path traversal, workspace isolation |
| dlp-engine | `DlpEngine` | Credential/PII/financial leak prevention |
| subagent-scope | `SubagentScope` | Permission downscoping, no-escalation |
| credential-vault | `CredentialVault` | Per-agent credential isolation |
| secrets-store | `SecretsStore` | AES-256-GCM encrypted secrets |
| content-safety | `ContentSafety` | Harmful content detection |
| data-retention | `DataRetention` | GDPR erasure, auto-cleanup |
| anomaly-detector | `AnomalyDetector` | Behavioral baseline alerting |
| audit-logger | `AuditLogger` | Hash-chain tamper-evident logging |
| injection-patterns | (patterns DB) | 31 injection + 16 exfil + 12 backdoor patterns |

### Business Solutions

| Solution | Directory | Use Case |
|----------|-----------|----------|
| Retail Isolated | `src/tenancy/` | Multi-tenant SaaS, per-tenant isolation |
| Corporate Pyramidal | `src/corporate/` | Org hierarchy, approval workflows, SSO |
| Group of Companies | `src/group/` | Holding structure, cross-company services |

### Infrastructure

| Module | File | Purpose |
|--------|------|---------|
| Agent Hierarchy | `src/agents/agent-permissions.ts` | 3-tier permission system |
| Cost Tracking | `src/billing/cost-tracker.ts` | Per-agent JSONL billing |
| Cost Models | `src/billing/cost-models.ts` | LLM pricing (Anthropic/OpenAI/Google) |
| Auto-Healer | `src/health/auto-healer.ts` | 8 issue type auto-fix |
| Smart Router | `src/routing/smart-router.ts` | Claude Code load balancing |

## Infrastructure

- **4 Mac machines** — Mini 1 (Jarvis, VS Assistant, Trinity), Mini 2 (Justin, Stark, Boris+), Mini 3 (Bob, Maximus), Mac Studio (Rex, Bolito, Creator)
- **1 VPS** — 100.102.127.45 (lowest risk, deploy first)
- **28 agents** across all machines
- **3 Claude Max subscriptions** — load balanced via SmartRouter
- **Tailscale mesh** — hub-spoke model for inter-machine communication

## Sync Strategy

The fork syncs weekly from upstream OpenClaw (Monday 09:00 via cron). Protected paths (security, billing, health, agents, routing) always keep our version. See [FORK_VERSION.md](../FORK_VERSION.md) for full merge rules and conflict resolution.

## License

Same as upstream OpenClaw. Enterprise modules in this fork are proprietary additions.
