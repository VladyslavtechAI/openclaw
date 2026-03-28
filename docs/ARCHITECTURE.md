# OpenClaw Enterprise Fork -- Architecture Documentation

This document describes the system architecture, module dependencies, data flows,
storage design, security layers, and agent hierarchy for the OpenClaw enterprise
fork. All diagrams are ASCII art for portability.

---

## Table of Contents

1. [System Architecture Overview](#system-architecture-overview)
2. [Module Dependency Graph](#module-dependency-graph)
3. [Data Flow Diagrams](#data-flow-diagrams)
4. [Storage Architecture](#storage-architecture)
5. [Security Architecture](#security-architecture)
6. [Agent Hierarchy](#agent-hierarchy)

---

## 1. System Architecture Overview

The deployment spans 4 Mac machines and 1 VPS, connected via a Tailscale mesh
network in a hub-spoke topology. Three Claude Max subscriptions are load-balanced
through the SmartRouter. Each machine runs its own OpenClaw gateway instance.

```
                        +---------------------------+
                        |      Tailscale Mesh       |
                        |   Hub-Spoke Topology      |
                        |   (100.64.0.0/10 CGNAT)  |
                        +---------------------------+
                                    |
        +---------------------------+---------------------------+
        |               |                  |                    |
        v               v                  v                    v
+---------------+ +---------------+ +---------------+ +------------------+
|   Mac Mini 1  | |   Mac Mini 2  | |   Mac Mini 3  | |   Mac Studio     |
|               | |               | |               | |                  |
| Agents:       | | Agents:       | | Agents:       | | Agents:          |
|  - Jarvis     | |  - Justin     | |  - Bob        | |  - Rex           |
|  - VS Assist. | |  - Stark      | |  - Maximus    | |  - Bolito        |
|  - Trinity    | |  - Boris+     | |               | |  - Creator       |
|               | |               | |               | |                  |
| [Gateway]     | | [Gateway]     | | [Gateway]     | | [Gateway]        |
+-------+-------+ +-------+-------+ +-------+-------+ +--------+---------+
        |                 |                 |                    |
        +--------+--------+--------+--------+                   |
                 |                 |                             |
                 v                 v                             |
        +-----------------+  +-----------+                      |
        |   VPS           |  |           |                      |
        | 100.102.127.45  |  |  Claude   |<---------------------+
        |                 |  |  Max x3   |
        | [Gateway]       |  | (SmartR.) |
        +-----------------+  +-----------+

LEGEND:
  [Gateway]  = OpenClaw gateway instance (one per machine)
  SmartR.    = SmartRouter load balancer across 3 Claude Max subscriptions
  Tailscale  = Encrypted WireGuard mesh; all inter-machine traffic is tunneled
```

### SmartRouter Load Balancing

The SmartRouter (`src/routing/smart-router.ts`) distributes requests across
three Claude Max subscription instances. It prioritizes free Claude Code
usage over paid API calls.

```
                    +-------------------+
                    |   Incoming        |
                    |   Request         |
                    +--------+----------+
                             |
                             v
                    +-------------------+
                    |   SmartRouter     |
                    |   (enabled?)      |
                    +--------+----------+
                             |
               +-------------+-------------+
               |                           |
               v                           v
     +-------------------+       +-------------------+
     | Try Claude Code   |       | Routing disabled  |
     | (free Opus)       |       | -> Direct to API  |
     +--------+----------+       +-------------------+
              |
    +---------+---------+
    |         |         |
    v         v         v
 +------+  +------+  +------+
 | Sub1 |  | Sub2 |  | Sub3 |     3 Claude Max subscriptions
 | ~250 |  | ~250 |  | ~250 |     ~250 msgs/day each
 |msgs/d|  |msgs/d|  |msgs/d|     5h sliding rate-limit window
 +--+---+  +--+---+  +--+---+
    |         |         |
    +----+----+----+----+
         |         |
         v         v
   +-----------+  +-----------+
   | Available |  | All rate  |
   | instance  |  | limited   |
   | found     |  +-----+-----+
   | cost: $0  |        |
   +-----------+  +------+------+------+
                  |             |      |
                  v             v      v
              [Queue]       [API]  [Notify]
              (retry        ($$$   (alert
              later)        cost)  admin)
```

---

## 2. Module Dependency Graph

### Security Layer Dependencies

The security modules form a layered defense system. The shared pattern database
in `injection-patterns.ts` feeds multiple detection modules.

```
src/security/injection-patterns.ts
    |
    |  Exports:
    |    INJECTION_PATTERNS -----> injection-shield.ts  (pattern + structural + context)
    |    EXEC_EXFIL_PATTERNS ----> exfil-guard.ts       (exec command analysis)
    |    BACKDOOR_PATTERNS ------> backdoor-scanner.ts  (workspace/config scanning)
    |    RESTRICTED_NETWORKS ----> network-policy.ts     (SSRF protection)
    |
    v

+---------------------------+     +---------------------------+
| injection-shield.ts       |     | network-policy.ts         |
| - Pattern matching        |     | - URL allowlist/blocklist |
| - Structural analysis     |     | - SSRF protection         |
| - Context scoring         |     | - Restricted networks     |
| - Action: pass/warn/      |     | - Exec command checking   |
|   sanitize/block          |     +---------------------------+
+---------------------------+               |
                                            |
+---------------------------+     +---------v-----------------+
| exfil-guard.ts            |     | filesystem-policy.ts      |
| - Exec exfil detection    |     | - Path traversal block    |
| - Credential scanning     |     | - Hidden file protection  |
| - Message/URL analysis    |     | - Workspace isolation     |
| - Pipe chain detection    |     | - Symlink blocking        |
+---------------------------+     +---------------------------+

+---------------------------+     +---------------------------+
| dlp-engine.ts             |     | content-safety.ts         |
| - Credential detection    |     | - Harmful content         |
| - PII detection           |     | - Illegal content         |
| - Financial data          |     | - Hate speech             |
| - Action: block/redact/   |     | - Self-harm / weapons     |
|   warn/log                |     | - Per-agent overrides     |
+---------------------------+     +---------------------------+

+---------------------------+     +---------------------------+
| anomaly-detector.ts       |     | audit-logger.ts           |
| - Behavioral baseline     |     | - JSONL + SHA-256 chain   |
| - Exec frequency spikes   |     | - Secret scrubbing        |
| - New tool detection      |     | - Daily file rotation     |
| - Off-hours activity      |     | - Chain verification      |
| - Data volume anomalies   |     | - Query/filter support    |
+---------------------------+     +---------------------------+

+---------------------------+     +---------------------------+
| subagent-scope.ts         |     | secrets-store.ts          |
| - Permission downscoping  |     | - AES-256-GCM encryption  |
| - Tool restriction        |     | - PBKDF2 key derivation   |
| - Path restriction        |     | - Per-agent access ctrl   |
| - Exec/SSH/msg gating     |     | - Secret rotation         |
| Imports: AgentHierarchy   |     | - Version tracking        |
|   Level from config/      |     +---------------------------+
|   types.agent-hierarchy   |
+---------------------------+     +---------------------------+
                                  | credential-vault.ts       |
+---------------------------+     | - Per-agent isolation      |
| backdoor-scanner.ts       |     | - Hierarchy-based access   |
| - Workspace file scanning |     | - Env var building        |
| - Config backdoor detect  |     | Imports: AgentHierarchy   |
| - SSH key injection       |     |   Level from config/      |
| - Crontab injection       |     |   types.agent-hierarchy   |
+---------------------------+     +---------------------------+

+---------------------------+
| data-retention.ts         |
| - Retention policy mgmt   |
| - Automated cleanup       |
+---------------------------+
```

### Business Solutions Dependencies

```
+================================================================+
|  Solution 1: Multi-Tenant (src/tenancy/)                       |
|                                                                |
|  tenant-manager.ts  ---+---> tenant-isolation.ts               |
|  tenant-billing.ts     |         |                             |
|  tenant-dashboard.ts   |         +---> FilesystemPolicy        |
|  agent-templates.ts    |         +---> NetworkPolicy            |
|                        |         +---> CredentialVault          |
|                        |                                       |
+================================================================+

+================================================================+
|  Solution 2: Corporate (src/corporate/)                        |
|                                                                |
|  hierarchy-manager.ts                                          |
|  approval-workflow.ts                                          |
|  department-isolation.ts                                       |
|  reporting-pipeline.ts                                         |
|  sso-bridge.ts                                                 |
|  compliance-exporter.ts ---> AuditLogger (reads JSONL logs)    |
|     Exports: SOC 2, HIPAA, GDPR, ISO 27001, PCI-DSS           |
|                                                                |
+================================================================+

+================================================================+
|  Solution 3: Group of Companies (src/group/)                   |
|                                                                |
|  group-manager.ts -----+---> company-environment.ts            |
|  consolidated-billing   |---> shared-service-registry.ts       |
|  version-manager.ts     |---> cross-company-bus.ts             |
|                         |         |                            |
|                         |         +---> Approval gate           |
|                         |         +---> Full audit trail        |
|                         |                                      |
+================================================================+
```

### Infrastructure Dependencies

```
src/config/types.agent-hierarchy.ts
    |
    |  Exports: AgentHierarchyLevel (0 | 1 | 2)
    |           AgentHierarchyPermissions
    |           AgentHierarchyConfig
    |
    +-----------> credential-vault.ts
    +-----------> subagent-scope.ts
    +-----------> (agent permission checks throughout)

src/agents/                          src/routing/
    |                                    |
    +-- Agent lifecycle               +-- smart-router.ts
    +-- Auth profiles                 +-- resolve-route.ts
    +-- Bash tools + exec             +-- session-key.ts
    +-- Tool management               +-- account-lookup.ts

src/billing/                         src/health/
    |                                    |
    +-- cost-models.ts                +-- auto-healer.ts
    |   (per-model pricing)           |   - gateway_down fix
    +-- cost-tracker.ts               |   - auth_error fix
        (JSONL daily files)           |   - backup_stale fix
        (budget enforcement)          |   - agent_frozen fix
        (auto-downgrade)              |   - version_outdated fix
```

### Full Dependency Summary

```
                    +-------------------------------+
                    | src/config/                   |
                    | types.agent-hierarchy.ts      |
                    +-------+-----------+-----------+
                            |           |
              +-------------+     +-----+-----------+
              |                   |                 |
              v                   v                 v
  +------------------+  +-----------------+  +----------------+
  | credential-      |  | subagent-       |  | Agent perms    |
  | vault.ts         |  | scope.ts        |  | (src/agents/)  |
  +--------+---------+  +-----------------+  +----------------+
           |
           v
  +------------------+     +-------------------+
  | tenant-          |     | injection-        |
  | isolation.ts     |     | patterns.ts       |
  |  (Solution 1)    |     +---+---+---+---+---+
  |                  |         |   |   |   |
  |  Uses:           |         v   v   v   v
  |  - Filesystem    |     injection-shield
  |    Policy        |     exfil-guard
  |  - Network       |     backdoor-scanner
  |    Policy        |     network-policy
  |  - Credential    |
  |    Vault         |     +-------------------+
  +------------------+     | audit-logger.ts   |
                           |   Used by:        |
                           |   - All security  |
                           |   - Corporate     |
                           |     (compliance-  |
                           |      exporter)    |
                           +-------------------+
```

---

## 3. Data Flow Diagrams

### Request Flow

```
+--------+     +-----------+     +-------------------+
| User / |     |           |     |   SmartRouter     |
| Client | --> | Gateway   | --> |                   |
+--------+     | (per-     |     | 1. Free Claude    |
               |  machine) |     |    Code first     |
               +-----------+     | 2. Fallback: API  |
                                 | 3. Or: queue      |
                                 +--------+----------+
                                          |
                                          v
                              +-----------+-----------+
                              |       Agent           |
                              | (selected by router)  |
                              +-----------+-----------+
                                          |
                    SECURITY PIPELINE     |
                    (sequential checks)   |
                                          v
                              +-----------------------+
                              | L1: InjectionShield   |
                              | - Pattern matching    |
                              | - Structural analysis |
                              | - Context scoring     |
                              +----------+------------+
                                         | pass/block
                                         v
                              +-----------------------+
                              | L2: ExfilGuard        |
                              | - Exec command scan   |
                              | - Credential detect   |
                              | - URL/message scan    |
                              +----------+------------+
                                         | pass/block
                                         v
                              +-----------------------+
                              | L3: DlpEngine         |
                              | - Credential patterns |
                              | - PII detection       |
                              | - Financial data      |
                              +----------+------------+
                                         | pass/redact/block
                                         v
                              +-----------------------+
                              | L4: NetworkPolicy     |
                              | - SSRF check          |
                              | - Restricted nets     |
                              | - URL allowlist       |
                              +----------+------------+
                                         | pass/block
                                         v
                              +-----------------------+
                              |   Tool Execution      |
                              | (exec, read, write,   |
                              |  web_fetch, etc.)     |
                              +----------+------------+
                                         |
                                         v
                              +-----------------------+
                              |   Response            |
                              |   (back to user)      |
                              +-----------------------+
```

### Audit Flow

Every action passes through the AuditLogger, which produces a tamper-evident
hash-chain log in JSONL format.

```
+-----------+     +-----------+     +-----------+     +-----------+
| Any       |     | Audit     |     | Secret    |     | JSONL     |
| action    | --> | Logger    | --> | Scrubbing | --> | File      |
| (tool,    |     |           |     | (API keys,|     | (daily    |
|  auth,    |     | Assigns:  |     |  tokens,  |     |  rotation)|
|  policy,  |     | - seq #   |     |  PII,     |     |           |
|  session) |     | - hash    |     |  passwords|     | audit-    |
+-----------+     | - prevHash|     |  etc.)    |     | YYYY-MM-  |
                  +-----------+     +-----------+     | DD.jsonl  |
                                                      +-----+-----+
                                                            |
                  +------------------------------------------+
                  |
                  v
          +-------+--------+     +-------------------+
          | Hash Chain      |     | Compliance        |
          | Verification    |     | Exporter          |
          |                 |     | (src/corporate/)  |
          | SHA-256 per     |     |                   |
          | record:         |     | Reads JSONL logs  |
          | seq:prevHash:   |     | Generates:        |
          |  timestamp:     |     | - SOC 2 evidence  |
          |  type:agentId:  |     | - HIPAA exports   |
          |  action         |     | - GDPR reports    |
          +-----------------+     +-------------------+
```

### Cost Flow

```
+-----------+     +-----------+     +-------------------+
| Request   |     | Cost      |     | cost-models.ts    |
| (any LLM  | --> | Tracker   | --> | Calculates cost   |
|  API call) |     |           |     | per model:        |
+-----------+     | Records:  |     | - Input tokens    |
                  | - agentId |     | - Output tokens   |
                  | - model   |     | - Cached tokens   |
                  | - tokens  |     | - USD pricing     |
                  | - cost    |     +-------------------+
                  +-----+-----+
                        |
                        v
              +---------+---------+
              | JSONL daily file  |
              | usage-YYYY-MM-    |
              | DD.jsonl          |
              +-------------------+
                        |
                        v
              +---------+---------+     +-------------------+
              | Budget Check      |     | Budget exceeded?  |
              |                   | --> |                   |
              | dailyCost vs      |     | blockOnExceed:    |
              | dailyBudget       |     |   -> deny request |
              | (per agent)       |     |                   |
              +-------------------+     | modelOnExceed:    |
                                        |   -> auto-down-  |
                                        |     grade model   |
                                        |   (e.g. Opus ->  |
                                        |    Sonnet)        |
                                        +-------------------+
```

### Tenant Isolation Flow (Solution 1)

```
+-----------+     +-------------------+     +---------------------+
| Request   |     | TenantManager     |     | TenantIsolation     |
| (inbound) | --> | Resolves tenant   | --> | Composes:           |
+-----------+     | from context      |     |                     |
                  +-------------------+     | +-- Filesystem      |
                                            | |   Policy          |
                                            | |   (workspace only)|
                                            | |                   |
                                            | +-- Network         |
                                            | |   Policy          |
                                            | |   (webhook only)  |
                                            | |                   |
                                            | +-- Credential      |
                                            |     Vault           |
                                            |     (tenant-scoped) |
                                            +----------+----------+
                                                       |
                                                       v
                                            +---------------------+
                                            | Sandboxed Execution |
                                            |                     |
                                            | ENV vars:           |
                                            |  TENANT_ID          |
                                            |  TENANT_WORKSPACE   |
                                            |  TENANT_LOGS        |
                                            |  PATH=/usr/bin:/bin |
                                            |  (SSH_AUTH removed) |
                                            +---------------------+

  Tenant directory structure:
  <base>/<tenantId>/
      +-- workspace/       (sandboxed file access)
      +-- logs/            (tenant-specific logs)
      +-- billing/         (tenant cost tracking)
      +-- credentials/     (tenant vault.json)
```

### Cross-Company Flow (Solution 3)

```
+-----------+           +-------------------+           +-----------+
| Company A |           | CrossCompanyBus   |           | Company B |
|           |           |                   |           |           |
| sendMsg() +---------->| 1. Create message |           |           |
|           |           |    (status:       |           |           |
|           |           |     pending)      |           |           |
|           |           |                   |           |           |
|           |           | 2. Add audit      |           |           |
|           |           |    entry          |           |           |
|           |           |                   |           |           |
|           |           | 3. If requires    |           |           |
|           |           |    approval:      |           |           |
|           |           |    -> pending     |           |           |
|           |           |    approvals list |           |           |
|           |           |                   |           |           |
|           |           |    Approval Gate  |           |           |
|           |           |    +-----------+  |           |           |
|           |           |    | Approve / |  |           |           |
|           |           |    | Reject    |<-+-----------+ B reviews |
|           |           |    +-----------+  |           |           |
|           |           |                   |           |           |
|           |           | 4. If approved:   |           |           |
|           |           |    status ->      +---------->| B receives|
|           |           |    delivered      |           | payload   |
|           |           |                   |           |           |
|           |           | 5. B can send     |           |           |
|           |<----------+    response       |<----------+ sendResp()|
|           |           |    (no approval   |           |           |
| A receives|           |     needed for    |           |           |
| response  |           |     responses)    |           |           |
+-----------+           +-------------------+           +-----------+

  Message states: pending -> approved -> delivered
                  pending -> rejected
                  approved -> failed
                  (requiresApproval=false) -> delivered (immediate)
```

---

## 4. Storage Architecture

All data is stored as local files. There are no external databases.

### Storage Format Summary

```
+---------------------+--------------------+----------------------------------+
| Data Type           | Format             | Location                         |
+---------------------+--------------------+----------------------------------+
| Billing/usage       | JSONL              | usage-YYYY-MM-DD.jsonl           |
| Audit logs          | JSONL + hash chain | audit-YYYY-MM-DD.jsonl           |
| Secrets             | Encrypted JSON     | secrets.json (AES-256-GCM)       |
| Tenant data         | Directory tree     | <base>/<tenantId>/               |
| Company data        | Directory tree     | <base>/<companyId>/              |
| Compliance evidence | JSON               | evidence/<framework>-<id>.json   |
| Config              | JSON/JSONL         | ~/.openclaw/                     |
+---------------------+--------------------+----------------------------------+
```

### Billing Storage

```
<dataDir>/
    +-- usage-2026-03-27.jsonl
    +-- usage-2026-03-28.jsonl
    +-- ...

Each line (UsageRecord):
{
  "timestamp": 1711612800000,
  "agentId": "jarvis",
  "model": "claude-opus-4-6",
  "inputTokens": 4200,
  "outputTokens": 1800,
  "cachedInputTokens": 2000,
  "cost": 0.198,
  "sessionKey": "session_abc123"
}
```

### Audit Log Storage (Hash Chain)

```
<logDir>/
    +-- audit-2026-03-27.jsonl
    +-- audit-2026-03-28.jsonl
    +-- ...

Each line (AuditRecord):
{
  "timestamp": 1711612800000,
  "type": "tool.exec",
  "agentId": "jarvis",
  "action": "bash: git status",
  "result": "allowed",
  "seq": 42,
  "prevHash": "a1b2c3d4e5f6g7h8",
  "hash": "i9j0k1l2m3n4o5p6"
}

Hash computation:
  SHA-256( seq : prevHash : timestamp : type : agentId : action )
  Truncated to first 16 hex characters.
  First record's prevHash = "genesis"

Secret scrubbing patterns:
  sk-ant-api**  -> [REDACTED:anthropic_key]
  sk-proj-**    -> [REDACTED:openai_key]
  ghp_**        -> [REDACTED:github_token]
  AIzaSy**      -> [REDACTED:google_key]
  AKIA**        -> [REDACTED:aws_key]
  -----BEGIN PRIVATE KEY-----  -> [REDACTED:private_key]
  password:"**" -> password=[REDACTED]
```

### Secrets Storage (Encrypted)

```
<storePath>/
    +-- secrets.json

Encryption:
  Algorithm:  AES-256-GCM
  Key:        PBKDF2(masterPassword, "openclaw-secrets-salt", 100000, 32, sha256)
  Per-secret: Random 16-byte IV + auth tag

Each entry:
{
  "id": "<random 32-hex>",
  "agentId": "jarvis",
  "key": "GITHUB_TOKEN",
  "encryptedValue": "<hex>",
  "iv": "<hex>",
  "authTag": "<hex>",
  "createdAt": 1711612800000,
  "rotatedAt": null,
  "version": 1
}

Access control: per-agent isolation (agentId must match on read/rotate/delete)
```

### Tenant Directory Structure (Solution 1)

```
<base>/<tenantId>/
    +-- workspace/         Sandboxed file operations
    |   +-- project-a/
    |   +-- project-b/
    +-- logs/              Tenant-specific audit and application logs
    +-- billing/           Per-tenant cost tracking (JSONL)
    +-- credentials/       Tenant credential vault
        +-- vault.json
```

### Company Directory Structure (Solution 3)

```
<base>/<companyId>/
    +-- workspace/         Company-isolated workspace
    +-- agents/            Company agent configurations
    +-- billing/           Company cost data
    +-- services/          Shared service registrations
```

---

## 5. Security Architecture

Defense is organized in seven layers plus cross-cutting concerns. Each layer
addresses a specific threat category. Layers are applied sequentially during
request processing.

```
+===================================================================+
|                    SECURITY LAYER STACK                            |
|===================================================================|
|                                                                   |
|  Layer 7: AnomalyDetector          (behavioral deviation)         |
|  +-------------------------------------------------------------+ |
|  | Monitors: exec frequency, new tools, off-hours activity,    | |
|  |           data volume spikes, failed auth patterns           | |
|  | Method:   Builds per-agent baseline profile over time        | |
|  |           Flags deviations (e.g. 3x normal exec rate)       | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  Layer 6: ContentSafety             (harmful content)             |
|  +-------------------------------------------------------------+ |
|  | Categories: harmful, illegal, hate_speech, self_harm,        | |
|  |             weapons, drugs                                   | |
|  | Actions:    block / warn / log (per category)                | |
|  | Config:     Per-agent policy overrides supported             | |
|  | Threshold:  0-1 confidence scoring                           | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  Layer 5: DlpEngine                (data loss prevention)         |
|  +-------------------------------------------------------------+ |
|  | Detects:  credential patterns (API keys, tokens, SSH keys)   | |
|  |           PII (SSN, email, phone, credit card)               | |
|  |           financial data (account numbers, routing numbers)  | |
|  | Actions:  block / redact / warn / log                        | |
|  | Output:   Sanitized content with findings report             | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  Layer 4: ExfilGuard                (data exfiltration)           |
|  +-------------------------------------------------------------+ |
|  | Scans:   Exec commands for data theft patterns               | |
|  |          - HTTP exfil (curl POST, wget --post)               | |
|  |          - Netcat outbound connections                       | |
|  |          - File transfers (scp, rsync, sftp)                 | |
|  |          - Script-based (python requests, node fetch)        | |
|  |          - Pipe chains (| curl, | ssh)                       | |
|  |          - DNS exfiltration (dig, nslookup with $())         | |
|  | Also:    Outbound message credential scanning                | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  Layer 3: FilesystemPolicy          (path security)               |
|  +-------------------------------------------------------------+ |
|  | Blocks:  Path traversal (../ sequences)                      | |
|  |          Hidden file access (dotfiles)                       | |
|  |          Symlink following (escape workspace)                | |
|  | Enforces: Workspace-only access per tenant/agent             | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  Layer 2: NetworkPolicy             (network security)            |
|  +-------------------------------------------------------------+ |
|  | Blocks:  SSRF to internal networks:                          | |
|  |          - 127.0.0.0/8    (loopback)                         | |
|  |          - 10.0.0.0/8     (private)                          | |
|  |          - 172.16.0.0/12  (private)                          | |
|  |          - 192.168.0.0/16 (private)                          | |
|  |          - 100.64.0.0/10  (Tailscale CGNAT)                  | |
|  |          - 169.254.0.0/16 (cloud metadata)                   | |
|  |          - ::1/128, fd00::/8, fe80::/10 (IPv6)               | |
|  | Supports: URL allowlist / blocklist per tenant               | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  Layer 1: InjectionShield           (prompt injection)            |
|  +-------------------------------------------------------------+ |
|  | Analysis: Pattern matching (57 known injection patterns)     | |
|  |           Structural analysis (role tags, separators)        | |
|  |           Context scoring (source trust levels)              | |
|  | Categories: direct, indirect, encoded, structural,           | |
|  |             exfiltration, jailbreak                          | |
|  | Actions:  pass / warn / sanitize / block                     | |
|  |           Based on cumulative severity score                 | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|===================================================================|
|  CROSS-CUTTING CONCERNS                                          |
|===================================================================|
|                                                                   |
|  AuditLogger (hash-chain tamper-evident)                          |
|  +-------------------------------------------------------------+ |
|  | Every security event is logged with:                         | |
|  |   - Sequential numbering (seq)                               | |
|  |   - SHA-256 hash chain (prevHash -> hash)                    | |
|  |   - Automatic secret scrubbing                               | |
|  |   - Daily JSONL file rotation                                | |
|  | Chain verification detects any log tampering                 | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  SubagentScope (permission downscoping)                           |
|  +-------------------------------------------------------------+ |
|  | Ensures subagents NEVER exceed parent permissions:           | |
|  |   - Default tools: read, write, web_search, web_fetch,      | |
|  |     image, pdf                                               | |
|  |   - Restricted: exec, message, gateway, cron, sessions_send,| |
|  |     sessions_spawn, browser                                  | |
|  |   - SSH/exec/message-send require explicit opt-in            | |
|  |   - Hierarchy level can only stay same or increase (restrict)| |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  BackdoorScanner (workspace integrity)                            |
|  +-------------------------------------------------------------+ |
|  | Scans workspace and config files for:                        | |
|  |   - Secret exfiltration instructions in .md files            | |
|  |   - Concealment directives ("don't tell the user")           | |
|  |   - Security bypass instructions                             | |
|  |   - Hidden HTML comment injections                           | |
|  |   - Remote code execution (curl | bash)                      | |
|  |   - Config backdoors (open access, disabled auth)            | |
|  |   - SSH key injection in authorized_keys                     | |
|  |   - Crontab injection with network tools                     | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  CredentialVault + SecretsStore (credential management)           |
|  +-------------------------------------------------------------+ |
|  | CredentialVault: Runtime access control                      | |
|  |   - Per-agent access based on hierarchy level                | |
|  |   - Optional agent allowlists per credential                 | |
|  |   - Environment variable injection for sandboxed exec       | |
|  | SecretsStore: At-rest encryption                             | |
|  |   - AES-256-GCM with PBKDF2 key derivation (100k iters)     | |
|  |   - Per-secret IV and auth tag                               | |
|  |   - Secret rotation with version tracking                   | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  DataRetention (lifecycle management)                             |
|  +-------------------------------------------------------------+ |
|  | Configurable retention policies per data type                | |
|  | Automated cleanup of expired audit/billing/session data      | |
|  +-------------------------------------------------------------+ |
|                                                                   |
+===================================================================+
```

---

## 6. Agent Hierarchy

The agent hierarchy defines three levels with progressively restricted
permissions. Lower numeric level = higher privilege. The hierarchy is defined
in `src/config/types.agent-hierarchy.ts`.

```
+=======================================================================+
| Level 0: ADMIN                                                        |
|-----------------------------------------------------------------------|
| Agents:  System administrators, primary operator agents               |
|                                                                       |
| Permissions:                                                          |
|   SSH access .............. all machines                               |
|   Credentials ............. read + write (full access)                 |
|   Gateway restart ......... yes                                       |
|   Spawn subagents ......... yes                                       |
|   Send to agents .......... all (any agent, any level)                |
|   Tool access ............. unrestricted                               |
+=======================================================================+
                          |
                          | can spawn / supervise
                          v
+=======================================================================+
| Level 1: LEAD                                                         |
|-----------------------------------------------------------------------|
| Agents:  Team leads, project coordinators, specialized supervisors    |
|                                                                       |
| Permissions:                                                          |
|   SSH access .............. none                                       |
|   Credentials ............. read-only                                  |
|   Gateway restart ......... no                                        |
|   Spawn subagents ......... yes (level 2 only)                        |
|   Send to agents .......... same level + lower (leads + workers)      |
|   Tool access ............. configurable via tools_allow/tools_deny   |
+=======================================================================+
                          |
                          | can spawn / supervise
                          v
+=======================================================================+
| Level 2: WORKER                                                       |
|-----------------------------------------------------------------------|
| Agents:  Task executors, specialized single-purpose agents            |
|                                                                       |
| Permissions:                                                          |
|   SSH access .............. none                                       |
|   Credentials ............. none                                       |
|   Gateway restart ......... no                                        |
|   Spawn subagents ......... no                                        |
|   Send to agents .......... same level only (other workers in team)   |
|   Tool access ............. restricted (default safe set only)        |
+=======================================================================+
```

### Permission Matrix

```
+-------------------+-----------+-----------+-----------+
| Capability        | Level 0   | Level 1   | Level 2   |
|                   | (Admin)   | (Lead)    | (Worker)  |
+-------------------+-----------+-----------+-----------+
| SSH access        | All       | None      | None      |
| Credential read   | Yes       | Yes       | No        |
| Credential write  | Yes       | No        | No        |
| Gateway restart   | Yes       | No        | No        |
| Spawn subagents   | Yes       | Yes (L2)  | No        |
| Send to any agent | Yes       | No        | No        |
| Send to lead      | Yes       | Yes       | No        |
| Send to worker    | Yes       | Yes       | Yes       |
| Exec tool         | Yes       | Config    | Restricted|
| Browser tool      | Yes       | Config    | No        |
| Message tool      | Yes       | Config    | No        |
+-------------------+-----------+-----------+-----------+
```

### Hierarchy Configuration Example

```
Agent configuration (AgentHierarchyConfig):

{
  "jarvis": {
    "level": 0,
    "workers": ["trinity", "vs-assistant"],
    "permissions": {
      "ssh": "all",
      "credentials": "all",
      "gateway_restart": true,
      "spawn_subagents": true,
      "send_to_agents": "all"
    }
  },
  "trinity": {
    "level": 1,
    "lead": "jarvis",
    "workers": ["bob"],
    "permissions": {
      "ssh": "none",
      "credentials": "read",
      "gateway_restart": false,
      "spawn_subagents": true,
      "send_to_agents": "team"
    }
  },
  "bob": {
    "level": 2,
    "lead": "trinity",
    "permissions": {
      "ssh": "none",
      "credentials": "none",
      "gateway_restart": false,
      "spawn_subagents": false,
      "send_to_agents": "team"
    }
  }
}
```

### SubagentScope Enforcement

When a parent spawns a subagent, the SubagentScope enforcer guarantees
permission downscoping:

```
Parent (Level 1, Lead)          Subagent (Level 2, Worker)
+---------------------------+   +---------------------------+
| Tools: read, write, exec, |   | Tools: read, write,       |
|   web_search, web_fetch,  |   |   web_search, web_fetch,  |
|   image, pdf, message     |   |   image, pdf              |
|                           |   |                           |
| Exec: allowed             |   | Exec: NOT allowed         |
| SSH: none                 |   | SSH: NOT allowed          |
| Message send: allowed     |   | Message send: NOT allowed |
| Paths: /workspace/*       |   | Paths: /workspace/sub/*   |
+---------------------------+   +---------------------------+

Rules enforced by SubagentScope:
  1. Subagent level >= parent level (cannot escalate)
  2. Restricted tools (exec, message, gateway, cron, sessions_send,
     sessions_spawn, browser) are stripped unless explicitly granted
  3. Default subagent tools: read, write, web_search, web_fetch,
     image, pdf
  4. Path access can only be narrowed, not widened
```

---

## Source File Reference

| Module | Path |
|--------|------|
| Agent Hierarchy Types | `src/config/types.agent-hierarchy.ts` |
| Injection Patterns DB | `src/security/injection-patterns.ts` |
| InjectionShield | `src/security/injection-shield.ts` |
| NetworkPolicy | `src/security/network-policy.ts` |
| FilesystemPolicy | `src/security/filesystem-policy.ts` |
| ExfilGuard | `src/security/exfil-guard.ts` |
| BackdoorScanner | `src/security/backdoor-scanner.ts` |
| DlpEngine | `src/security/dlp-engine.ts` |
| ContentSafety | `src/security/content-safety.ts` |
| AnomalyDetector | `src/security/anomaly-detector.ts` |
| AuditLogger | `src/security/audit-logger.ts` |
| SubagentScope | `src/security/subagent-scope.ts` |
| CredentialVault | `src/security/credential-vault.ts` |
| SecretsStore | `src/security/secrets-store.ts` |
| DataRetention | `src/security/data-retention.ts` |
| SmartRouter | `src/routing/smart-router.ts` |
| CostTracker | `src/billing/cost-tracker.ts` |
| CostModels | `src/billing/cost-models.ts` |
| AutoHealer | `src/health/auto-healer.ts` |
| TenantManager | `src/tenancy/tenant-manager.ts` |
| TenantIsolation | `src/tenancy/tenant-isolation.ts` |
| TenantBilling | `src/tenancy/tenant-billing.ts` |
| TenantDashboard | `src/tenancy/tenant-dashboard.ts` |
| AgentTemplates | `src/tenancy/agent-templates.ts` |
| HierarchyManager | `src/corporate/hierarchy-manager.ts` |
| ApprovalWorkflow | `src/corporate/approval-workflow.ts` |
| DepartmentIsolation | `src/corporate/department-isolation.ts` |
| ReportingPipeline | `src/corporate/reporting-pipeline.ts` |
| SSOBridge | `src/corporate/sso-bridge.ts` |
| ComplianceExporter | `src/corporate/compliance-exporter.ts` |
| GroupManager | `src/group/group-manager.ts` |
| CompanyEnvironment | `src/group/company-environment.ts` |
| SharedServiceRegistry | `src/group/shared-service-registry.ts` |
| CrossCompanyBus | `src/group/cross-company-bus.ts` |
| ConsolidatedBilling | `src/group/consolidated-billing.ts` |
| VersionManager | `src/group/version-manager.ts` |
