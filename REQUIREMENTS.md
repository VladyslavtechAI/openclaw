# OpenClaw Enterprise Fork — Requirements

## Context
We have a fork of openclaw/openclaw with 12 security modules, agent hierarchy, cost tracking, auto-healer, smart router, and credential isolation. We need to extend this into 3 production solutions.

## Current Fork Modules (DONE)
1. **Agent Hierarchy** — 3-tier permissions (admin/lead/worker), SSH/credentials/gateway access
2. **Cost Tracking** — JSONL usage tracking, budget enforcement, auto-downgrade on limit
3. **Auto-Healer** — 8 issue types, cooldown, escalation (from 37K real errors)
4. **Smart Router** — Claude Code load balancing, rate limit awareness, 3 policies
5. **Credential Isolation** — per-agent credential vault, hierarchy-based access
6. **Injection Shield** — 3-layer prompt injection defense (pattern/structural/context)
7. **Network Policy** — SSRF protection, cloud metadata blocking, URL whitelist
8. **Backdoor Scanner** — file integrity monitoring, backdoor pattern detection
9. **Exfil Guard** — data exfiltration prevention (exec/message/URL)
10. **Filesystem Policy** — hidden paths, traversal protection, workspace isolation
11. **Audit Logger** — hash-chain tamper detection, secret scrubbing, JSONL
12. **Subagent Scope** — permission downscoping, no-escalation validation
13. **DLP Engine** — credential/PII/financial data leak prevention
14. **Secrets Store** — AES-256-GCM encryption, per-agent access, PBKDF2
15. **Content Safety** — category detection, configurable policies
16. **Data Retention** — auto-cleanup, GDPR erasure, retention policies
17. **Anomaly Detector** — baseline profiling, threshold alerts

## Infrastructure
- 4 Mac machines (Mini 1, Mini 2, Mini 3, Mac Studio) + 1 VPS
- 28 agents across machines
- 3 Claude Max subscriptions for free Opus via Claude Code CLI
- Tailscale mesh network (100.x.x.x)
- Hub-spoke model: Jarvis (main) orchestrates all agents

---

## SOLUTION 1: Retail Isolated
**For:** Retail businesses needing AI assistants per store/department

### Requirements
- **Complete isolation** between tenants (stores/departments)
- Each tenant gets own workspace, credentials, agent config
- No cross-tenant data access ever
- Simple deployment: one config file per tenant
- **Monitoring dashboard** per tenant (costs, usage, errors)
- **Budget caps** per tenant (hard limit, no overspend)
- **Pre-built agent templates**: customer service, inventory, scheduling, reporting
- **Webhook integrations**: POS systems, inventory, CRM
- **Multi-channel**: Telegram, WhatsApp, email per tenant
- **Auto-scaling**: spawn agents on demand, kill on idle
- **Compliance**: GDPR data isolation, audit logs per tenant

### Architecture Needed
- TenantManager (create/delete/suspend tenants)
- TenantIsolation (filesystem, network, credentials per tenant)
- TenantBilling (usage tracking, invoicing, budget enforcement)
- AgentTemplateRegistry (pre-built templates, customization)
- TenantDashboard (web UI for tenant admin)

---

## SOLUTION 2: Corporate Pyramidal
**For:** Enterprise companies with hierarchical agent management

### Requirements
- **Pyramidal hierarchy**: CEO-agent → Department heads → Team leads → Workers
- Central management agent (like Jarvis) with full visibility
- **Chain of command**: tasks flow down, reports flow up
- **Department isolation**: Marketing agents can't access Finance data
- **Approval workflows**: sensitive actions require lead/admin approval
- **Delegation**: admin can delegate specific capabilities to leads
- **Reporting chain**: automated daily/weekly reports up the hierarchy
- **SSO integration**: SAML/OIDC for enterprise auth
- **Role-based dashboards**: different views per hierarchy level
- **Compliance**: SOC 2 Type II, HIPAA-ready, full audit trail

### Architecture Needed
- HierarchyManager (org chart, reporting chains, delegation)
- ApprovalWorkflow (request → approve/deny → execute)
- DepartmentIsolation (data boundaries between departments)
- ReportingPipeline (automated rollup reports)
- SSOBridge (SAML/OIDC adapter)
- ComplianceExporter (SOC 2 evidence, HIPAA logs)

---

## SOLUTION 3: Group of Companies
**For:** Holding/group structure with multiple companies under one umbrella

### Requirements
- **Company-level isolation** (each company = separate environment)
- **Group-level oversight** (holding admin sees all companies)
- **Shared services**: some agents shared across companies (legal, HR)
- **Cross-company workflows**: agent in Company A can request data from Company B (with approval)
- **Consolidated billing**: per-company + group-level cost rollup
- **Unified identity**: one admin panel for all companies
- **Inter-company communication**: secure message bus between company agents
- **Data sovereignty**: company data stays in company boundary unless explicitly shared
- **Disaster recovery**: if one company goes down, others unaffected
- **Version management**: each company can run different fork version

### Architecture Needed
- GroupManager (companies, shared services, cross-company policies)
- CompanyEnvironment (isolated runtime per company)
- SharedServiceRegistry (agents available across companies)
- CrossCompanyBus (secure message routing between companies)
- ConsolidatedBilling (per-company + group rollup)
- GroupDashboard (admin panel for holding level)
- VersionManager (per-company version pinning, rollout strategy)

---

## Technical Requirements (ALL solutions)
- TypeScript, vitest tests (min 95% coverage per module)
- No external dependencies (Node.js built-ins only)
- Self-contained modules that plug into OpenClaw
- Upstream-compatible (can merge OpenClaw updates)
- Documentation: API docs, deployment guides, migration guides
- Performance: handle 100+ agents, 1000+ messages/min
- Security: all existing modules enforced by default

---

## Fork Versioning & Update System
- Semantic versioning (major.minor.patch)
- Weekly upstream sync (cron: Monday 09:00)
- Protected paths (our modules never overwritten by upstream)
- Automated test verification after every sync
- Rollback capability per machine
- Changelog generation from git commits
