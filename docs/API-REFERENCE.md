# OpenClaw Enterprise Fork — API Reference

Complete API reference for all enterprise modules: security, tenancy, corporate hierarchy, group-of-companies management, billing, health, agent permissions, and smart routing.

## Table of Contents

- [Security Modules](#security-modules)
  - [InjectionShield](#injectionshield)
  - [NetworkPolicy](#networkpolicy)
  - [BackdoorScanner](#backdoorscanner)
  - [ExfilGuard](#exfilguard)
  - [FilesystemPolicy](#filesystempolicy)
  - [DlpEngine](#dlpengine)
  - [SubagentScope](#subagentscope)
  - [CredentialVault](#credentialvault)
  - [SecretsStore](#secretsstore)
  - [ContentSafety](#contentsafety)
  - [DataRetention](#dataretention)
  - [AnomalyDetector](#anomalydetector)
  - [AuditLogger](#auditlogger)
  - [Injection Patterns](#injection-patterns)
- [Tenancy Modules (Solution 1 — Retail Isolated)](#tenancy-modules-solution-1--retail-isolated)
  - [TenantManager](#tenantmanager)
  - [TenantIsolation](#tenantisolation)
  - [TenantBilling](#tenantbilling)
  - [AgentTemplateRegistry](#agenttemplateregistry)
  - [TenantDashboard](#tenantdashboard)
- [Corporate Modules (Solution 2 — Corporate Pyramidal)](#corporate-modules-solution-2--corporate-pyramidal)
  - [HierarchyManager](#hierarchymanager)
  - [ApprovalWorkflow](#approvalworkflow)
  - [DepartmentIsolation](#departmentisolation)
  - [ReportingPipeline](#reportingpipeline)
  - [SSOBridge](#ssobridge)
  - [ComplianceExporter](#complianceexporter)
- [Group Modules (Solution 3 — Group of Companies)](#group-modules-solution-3--group-of-companies)
  - [GroupManager](#groupmanager)
  - [CompanyEnvironment](#companyenvironment)
  - [SharedServiceRegistry](#sharedserviceregistry)
  - [CrossCompanyBus](#crosscompanybus)
  - [ConsolidatedBilling](#consolidatedbilling)
  - [VersionManager](#versionmanager)
- [Billing Modules](#billing-modules)
  - [CostTracker](#costtracker)
  - [Cost Models](#cost-models)
- [Health Module](#health-module)
  - [AutoHealer](#autohealer)
- [Agent Permissions](#agent-permissions)
  - [AgentPermissions](#agentpermissions)
- [Smart Router](#smart-router)
  - [SmartRouter](#smartrouter)

---

## Security Modules

### InjectionShield

**Source:** `src/security/injection-shield.ts`

Three-layer prompt injection detection and sanitization engine. Analyzes content for direct injection, structural injection, and encoded injection patterns across 31 built-in rules.

#### Types

```typescript
type ContentContext = {
  source: "user" | "external" | "agent" | "tool_output" | "skill";
  type?: "web_fetch" | "pdf" | "email" | "message" | "exec_output" | "sessions_send";
  sourceAgentId?: string;
};

type InjectionFinding = {
  layer: "pattern" | "structural" | "context";
  name: string;
  severity: number;
  category: string;
  matchedText?: string;
};

type InjectionResult = {
  action: "pass" | "warn" | "sanitize" | "block";
  score: number;
  findings: InjectionFinding[];
};
```

#### Class: InjectionShield

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(customPatterns?: InjectionPattern[])` | Initialize with optional custom patterns. Custom patterns are added to the built-in set of 31 patterns. |
| `analyze` | `analyze(content: string, context: ContentContext): InjectionResult` | Run 3-layer analysis (pattern, structural, context). Score thresholds: block >= 0.8, sanitize >= 0.5, warn >= 0.2. Context multipliers: external 1.5x, web_fetch/pdf/email 1.8x, agent 1.3x, skill 1.6x. |
| `sanitize` | `sanitize(content: string): string` | Remove injection patterns from content. Strips role markers, HTML comments, zero-width characters, and RTL/LTR overrides. |

---

### NetworkPolicy

**Source:** `src/security/network-policy.ts`

Network access control enforcing URL allowlists/blocklists, SSRF protection across 9 restricted network ranges, and hierarchical capability gating.

#### Types

```typescript
type NetworkCapabilities = {
  web_fetch: boolean;
  web_search: boolean;
  exec_curl: boolean;
  exec_ssh: boolean;
  raw_sockets: boolean;
};

type UrlCheckResult = {
  allowed: boolean;
  reason?: string;
  restrictedNetwork?: string;
};
```

#### Class: NetworkPolicy

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { urlWhitelist?: string[]; urlBlacklist?: string[] })` | Initialize with optional URL allowlist and blocklist. |
| `checkUrl` | `checkUrl(url: string): UrlCheckResult` | Check whether a URL is allowed. Validates against SSRF protection (9 restricted networks), localhost detection, cloud metadata endpoint blocking, blocklist, and allowlist rules. |
| `checkExecCommand` | `checkExecCommand(command: string): UrlCheckResult` | Check whether an exec command is allowed. Blocks network scanning tools (nmap, masscan, zmap), raw socket tools (nc, ncat, netcat, socat, telnet), and validates URLs embedded in curl/wget commands. |
| `getCapabilities` | `getCapabilities(hierarchyLevel: number): NetworkCapabilities` | Return network capabilities for a given hierarchy level. Level 0: all capabilities except raw_sockets. Level 1: additionally disables exec_ssh. Level 2: additionally disables exec_curl. |

---

### BackdoorScanner

**Source:** `src/security/backdoor-scanner.ts`

File integrity monitoring and backdoor pattern detection. Maintains SHA-256 hash baselines and scans file content against 12 known backdoor patterns.

#### Types

```typescript
type FileBaseline = {
  path: string;
  hash: string;
  size: number;
  lastModified: number;
};

type IntegrityResult = {
  status: "ok" | "modified" | "new" | "deleted";
  path: string;
  details?: string;
};

type ScanFinding = {
  path: string;
  pattern: string;
  severity: "critical" | "high" | "medium" | "low";
  matchedText: string;
};

type FullScanResult = {
  integrity: IntegrityResult[];
  contentFindings: ScanFinding[];
  timestamp: number;
};
```

#### Class: BackdoorScanner

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { baselinePath?: string; watchPaths?: string[]; excludePaths?: string[] })` | Initialize scanner with optional baseline storage path, watched paths, and exclusion patterns. |
| `initBaseline` | `initBaseline(files: Array<{ path: string; content: string }>): void` | Create a SHA-256 hash baseline from the provided files. |
| `checkIntegrity` | `checkIntegrity(files: Array<{ path: string; content: string }>): IntegrityResult[]` | Compare provided files against the stored baseline. Reports modified, new, and deleted files. |
| `scanContent` | `scanContent(path: string, content: string): ScanFinding[]` | Scan a single file for 12 backdoor patterns. Severity is assigned by file type: package.json/Dockerfile = critical, .sh/.js/.ts = high, all others = medium. |
| `fullScan` | `fullScan(files: Array<{ path: string; content: string }>): FullScanResult` | Run combined integrity check and content scan across all provided files. |

---

### ExfilGuard

**Source:** `src/security/exfil-guard.ts`

Data exfiltration prevention for exec commands, outbound messages, and URLs. Detects 16 exec-based exfiltration patterns, API key leakage, and encoded secrets in URLs.

#### Types

```typescript
type ExfilCheckResult = {
  blocked: boolean;
  score: number;
  findings: ExfilFinding[];
};

type ExfilFinding = {
  type: string;
  pattern: string;
  severity: number;
  matchedText: string;
};
```

#### Class: ExfilGuard

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { blockThreshold?: number; customPatterns?: ExecExfilPattern[] })` | Initialize with optional block threshold (default: 0.7) and custom patterns. |
| `checkExec` | `checkExec(command: string): ExfilCheckResult` | Check exec commands for 16 exfiltration patterns including HTTP upload, netcat, file transfer, script download, pipe/redirect chains, and DNS exfiltration. |
| `checkMessage` | `checkMessage(message: string): ExfilCheckResult` | Check outbound messages for leaked API keys (Anthropic sk-ant-api/oat, OpenAI sk-proj, GitHub ghp_/github_pat_, Google AIzaSy, AWS AKIA), private keys, and base64-encoded blobs exceeding 50 characters. |
| `checkUrl` | `checkUrl(url: string): ExfilCheckResult` | Check URLs for encoded secrets in query parameters, base64 data in paths, and data: URI schemes. |

---

### FilesystemPolicy

**Source:** `src/security/filesystem-policy.ts`

Filesystem access control enforcing workspace boundaries, blocking sensitive paths, and preventing unauthorized file operations.

#### Types

```typescript
type FileAccessResult = {
  allowed: boolean;
  reason?: string;
};
```

#### Class: FilesystemPolicy

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { workspaceRoot?: string; additionalBlockedPaths?: string[] })` | Initialize with workspace root and optional additional blocked paths. |
| `checkAccess` | `checkAccess(filePath: string, operation: "read" \| "write" \| "delete"): FileAccessResult` | Check whether a file operation is allowed. Blocks null bytes, path traversal (../), hidden sensitive paths (.openclaw.json, .ssh, .env, .git/config, .npmrc, .docker, .aws, .kube), and enforces workspace root boundaries. Write/delete operations to node_modules are blocked. |
| `isWithinWorkspace` | `isWithinWorkspace(filePath: string): boolean` | Check whether a path resolves within the configured workspace root. |
| `getRestrictedPaths` | `getRestrictedPaths(): string[]` | Return all blocked path patterns. |

---

### DlpEngine

**Source:** `src/security/dlp-engine.ts`

Data Loss Prevention engine scanning content for credentials, PII, financial data, and internal identifiers. Supports configurable actions per pattern and agent exemptions.

#### Types

```typescript
type DlpAction = "block" | "redact" | "warn" | "log";

type DlpPattern = {
  name: string;
  pattern: RegExp;
  category: "credential" | "pii" | "financial" | "internal";
  defaultAction: DlpAction;
};

type DlpResult = {
  action: DlpAction;
  findings: DlpFinding[];
  sanitized?: string;
};

type DlpFinding = {
  pattern: string;
  category: string;
  position: number;
  preview: string;
};
```

#### Class: DlpEngine

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { patterns?: DlpPattern[]; defaultAction?: DlpAction; exemptAgents?: string[] })` | Initialize with optional custom patterns, default action, and exempt agent IDs. |
| `scan` | `scan(content: string, agentId?: string): DlpResult` | Scan content for 15 default patterns: anthropic_api_key, anthropic_oauth, openai_key, github_token, github_fine_grained, google_api_key, aws_access_key, generic_api_key, private_key, email_address, phone_number, ssn, credit_card, iban. Returns the highest-severity action found across all matches. Exempt agents bypass scanning. |
| `redact` | `redact(content: string): string` | Replace all pattern matches with `[REDACTED:pattern_name]` placeholders. |

---

### SubagentScope

**Source:** `src/security/subagent-scope.ts`

Privilege attenuation for subagent spawning. Computes the most restrictive intersection of parent and child scopes, preventing privilege escalation through the agent hierarchy.

#### Types

```typescript
type AgentScope = {
  allowedTools: string[];
  maxTokenBudget: number;
  networkAccess: boolean;
  fileSystemAccess: "none" | "read" | "write";
  maxSubagentDepth: number;
};

type ScopeValidation = {
  valid: boolean;
  violations: string[];
};
```

#### Class: SubagentScope (static methods)

| Method | Signature | Description |
|--------|-----------|-------------|
| `computeScope` | `static computeScope(parentScope: AgentScope, requestedScope: Partial<AgentScope>): AgentScope` | Compute the effective scope as the intersection (most restrictive) of parent and requested scopes. Tools: intersection of parent and requested sets. Budget: minimum of both. Network: logical AND. Filesystem: minimum access level. Depth: minimum of both, decremented by 1. |
| `isToolAllowed` | `static isToolAllowed(scope: AgentScope, tool: string): boolean` | Check whether a tool is in the scope's allowed tools list. |
| `validateNoEscalation` | `static validateNoEscalation(parentScope: AgentScope, childScope: AgentScope): ScopeValidation` | Validate that the child scope does not escalate privileges beyond the parent. Checks: tools are a subset, budget is less than or equal, network access is less than or equal, filesystem access is less than or equal, depth is less than or equal. |
| `getRestrictedTools` | `static getRestrictedTools(): string[]` | Returns the list of restricted tools: `["Bash", "Write", "Edit", "NotebookEdit"]`. |

---

### CredentialVault

**Source:** `src/security/credential-vault.ts`

Hierarchy-aware credential storage. Credentials are gated by agent hierarchy level and optional per-credential allowlists.

#### Types

```typescript
type CredentialEntry = {
  key: string;
  value: string;
  allowedAgents?: string[];
  minLevel?: AgentHierarchyLevel;
  shared?: boolean;
};

type VaultConfig = {
  credentials?: CredentialEntry[];
  defaultMinLevel?: AgentHierarchyLevel;
};
```

#### Class: CredentialVault

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: VaultConfig)` | Initialize with optional pre-loaded credentials and default minimum hierarchy level (default: 0, admin only). |
| `canAccess` | `canAccess(agentId: string, credentialKey: string, agentLevel: AgentHierarchyLevel): boolean` | Check whether an agent can access a credential based on hierarchy level and allowlist. |
| `get` | `get(agentId: string, credentialKey: string, agentLevel: AgentHierarchyLevel): string \| undefined` | Retrieve a credential value if the agent is authorized. Returns `undefined` if access is denied or the credential does not exist. |
| `getAccessibleCredentials` | `getAccessibleCredentials(agentId: string, agentLevel: AgentHierarchyLevel): Map<string, string>` | Retrieve all credentials accessible to the specified agent at the given hierarchy level. |
| `buildEnvForAgent` | `buildEnvForAgent(agentId: string, agentLevel: AgentHierarchyLevel, baseEnv?: Record<string, string>): Record<string, string>` | Build a complete environment variable map by merging authorized credentials into an optional base environment. |
| `addCredential` | `addCredential(entry: CredentialEntry): void` | Add or update a credential in the vault. |
| `removeCredential` | `removeCredential(key: string): boolean` | Remove a credential by key. Returns `true` if the credential existed. |
| `listCredentials` | `listCredentials(): Array<{ key: string; minLevel: AgentHierarchyLevel; allowedAgents?: string[]; shared: boolean }>` | List all credential metadata (keys, levels, allowlists). Values are never exposed. |

---

### SecretsStore

**Source:** `src/security/secrets-store.ts`

Encrypted secret storage using AES-256-GCM with PBKDF2 key derivation. Secrets are encrypted at rest and access-controlled by agent allowlists.

#### Types

```typescript
type SecretEntry = {
  key: string;
  encryptedValue: string;
  iv: string;
  salt: string;
  allowedAgents: string[];
  createdAt: number;
  rotatedAt?: number;
};

type SecretMetadata = {
  key: string;
  allowedAgents: string[];
  createdAt: number;
  rotatedAt?: number;
};
```

#### Class: SecretsStore

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(masterPassword: string)` | Initialize with a master password. Derives the encryption key via PBKDF2 (100,000 iterations, SHA-256). |
| `storeSecret` | `storeSecret(key: string, value: string, allowedAgents: string[]): void` | Encrypt a secret with AES-256-GCM and store it with the specified agent allowlist. |
| `getSecret` | `getSecret(key: string, agentId: string): string \| undefined` | Decrypt and return a secret if the requesting agent is in the allowedAgents list. Returns `undefined` if access is denied or the secret does not exist. |
| `rotateSecret` | `rotateSecret(key: string, newValue: string): boolean` | Re-encrypt a secret with a new value, preserving the allowlist. Updates the `rotatedAt` timestamp. Returns `false` if the secret does not exist. |
| `deleteSecret` | `deleteSecret(key: string): boolean` | Delete a secret by key. Returns `true` if the secret existed. |
| `listSecrets` | `listSecrets(): SecretMetadata[]` | List all secret metadata (keys, allowlists, timestamps). Encrypted values are never exposed. |
| `hasSecret` | `hasSecret(key: string): boolean` | Check whether a secret exists by key. |

---

### ContentSafety

**Source:** `src/security/content-safety.ts`

Content moderation engine with per-agent policy overrides. Scans content against configurable safety categories and returns graduated enforcement actions.

#### Types

```typescript
type ContentCategory =
  | "harmful"
  | "illegal"
  | "hate_speech"
  | "self_harm"
  | "weapons"
  | "drugs"
  | "sexual"
  | "violence";

type SafetyAction = "block" | "warn" | "flag" | "allow";

type SafetyResult = {
  action: SafetyAction;
  findings: SafetyFinding[];
};

type SafetyFinding = {
  category: ContentCategory;
  confidence: number;
  matchedText: string;
};

type SafetyPolicy = Partial<Record<ContentCategory, SafetyAction>>;
```

#### Class: ContentSafety

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { defaultPolicy?: SafetyPolicy })` | Initialize with an optional default safety policy mapping categories to actions. |
| `checkContent` | `checkContent(content: string, agentId?: string): SafetyResult` | Check content against all safety categories. Applies per-agent policy overrides if an agent-specific policy has been set. Returns the most restrictive action across all findings. |
| `setAgentPolicy` | `setAgentPolicy(agentId: string, policy: SafetyPolicy): void` | Set a custom safety policy for a specific agent, overriding the default policy for that agent's content checks. |
| `getAgentPolicies` | `getAgentPolicies(): Map<string, SafetyPolicy>` | Return all registered per-agent safety policies. |

---

### DataRetention

**Source:** `src/security/data-retention.ts`

Automated data lifecycle management with configurable retention periods per data type and GDPR right-to-erasure support.

#### Types

```typescript
type DataType =
  | "audit_logs"
  | "session_logs"
  | "temp_files"
  | "credentials"
  | "secrets";

type RetentionPolicy = {
  dataType: DataType;
  retentionDays: number;
  autoDelete: boolean;
};

type CleanupResult = {
  dataType: DataType;
  filesDeleted: number;
  bytesFreed: number;
};
```

#### Class: DataRetention

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { policies?: RetentionPolicy[]; dataDir?: string })` | Initialize with optional retention policies and data directory. |
| `cleanupDataType` | `cleanupDataType(dataType: DataType): Promise<CleanupResult>` | Delete files of the specified data type that exceed the configured retention period. |
| `cleanupAll` | `cleanupAll(): Promise<CleanupResult[]>` | Run cleanup across all configured data types. |
| `eraseData` | `eraseData(identifier: string): Promise<{ success: boolean; typesProcessed: DataType[] }>` | GDPR right-to-erasure: delete all data associated with the specified identifier across all data types. |
| `startAutoCleanup` | `startAutoCleanup(intervalMs?: number): void` | Start a periodic cleanup timer. Default interval: 86,400,000 ms (24 hours). |

---

### AnomalyDetector

**Source:** `src/security/anomaly-detector.ts`

Statistical anomaly detection using exponential smoothing baselines. Monitors agent activity across multiple dimensions and generates severity-graded alerts.

#### Types

```typescript
type AnomalyType =
  | "exec_frequency"
  | "new_tool"
  | "off_hours"
  | "data_volume"
  | "failed_auth"
  | "suspicious_path";

type AnomalyAlert = {
  type: AnomalyType;
  agentId: string;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
  timestamp: number;
  baselineValue?: number;
  observedValue?: number;
};

type BaselineEntry = {
  mean: number;
  stddev: number;
  sampleCount: number;
};
```

#### Class: AnomalyDetector

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { thresholds?: Partial<Record<AnomalyType, number>>; baselineWindow?: number })` | Initialize with optional per-type thresholds and baseline window size. |
| `recordActivity` | `recordActivity(agentId: string, type: AnomalyType, value: number): AnomalyAlert \| undefined` | Record an activity data point and check for anomalies. Uses exponential smoothing for baseline computation. Returns an alert if the observed value exceeds the configured threshold multiplied by the standard deviation from the mean. |
| `getAnomalies` | `getAnomalies(agentId?: string, since?: number): AnomalyAlert[]` | Retrieve alerts, optionally filtered by agent ID and/or timestamp. |
| `getBaseline` | `getBaseline(agentId: string): Map<AnomalyType, BaselineEntry>` | Return the current baseline statistics for a given agent across all anomaly types. |

---

### AuditLogger

**Source:** `src/security/audit-logger.ts`

Tamper-evident audit logging with SHA-256 hash chain integrity verification. Each log entry links to the previous entry's hash, forming a verifiable chain.

#### Types

```typescript
type AuditEntry = {
  timestamp: number;
  level: "info" | "warn" | "error" | "critical";
  agentId: string;
  action: string;
  details: Record<string, unknown>;
  previousHash?: string;
  hash: string;
};

type AuditQuery = {
  agentId?: string;
  level?: AuditEntry["level"];
  action?: string;
  since?: number;
  until?: number;
  limit?: number;
};
```

#### Class: AuditLogger

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { logDir?: string; scrubSecrets?: boolean })` | Initialize with optional log directory and secret scrubbing (default: enabled). |
| `log` | `log(level: AuditEntry["level"], agentId: string, action: string, details: Record<string, unknown>): AuditEntry` | Write a JSONL audit entry with a SHA-256 hash chain linking to the previous entry. Automatically scrubs 9 secret patterns from the details when scrubbing is enabled. |
| `verifyChain` | `verifyChain(): { valid: boolean; brokenAt?: number }` | Verify the integrity of the hash chain. Returns the index of the first broken link if the chain is invalid. |
| `query` | `query(q: AuditQuery): AuditEntry[]` | Query audit entries with optional filters for agent, level, action, time range, and result limit. |

#### Exported Function

```typescript
function scrubSecrets(text: string): string;
```

Replace 9 secret patterns in the provided text: Anthropic API keys, OAuth tokens, OpenAI keys, GitHub tokens, GitHub fine-grained PATs, Google API keys, AWS access keys, private key blocks, and generic secret assignments.

---

### Injection Patterns

**Source:** `src/security/injection-patterns.ts`

Shared pattern constants used by `InjectionShield`, `ExfilGuard`, `BackdoorScanner`, and `NetworkPolicy`. This module exports constants only (no class).

#### Exported Constants

**`INJECTION_PATTERNS: InjectionPattern[]`**

31 patterns across 5 categories:

| Category | Patterns |
|----------|----------|
| `direct_injection` | system override, role impersonation, instruction override, context manipulation, few-shot manipulation |
| `structural_injection` | delimiter, markdown, code block, HTML/XML tags |
| `encoded_injection` | base64, unicode escape, hex, URL encoding, rot13, homoglyph |
| `exfiltration` | URL param, image tag, markdown link, fetch request, webhook |
| `jailbreak` | DAN, token smuggling, hypothetical scenario |

**`EXEC_EXFIL_PATTERNS: ExecExfilPattern[]`**

16 patterns for detecting data exfiltration in shell commands:

`http_upload` (curl POST/PUT), `wget_exfil`, `netcat_listener`, `netcat_send`, `file_to_remote`, `scp_exfil`, `rsync_exfil`, `script_download`, `pipe_to_remote`, `base64_pipe`, `dd_network`, `tar_remote`, `mail_exfil`, `ftp_transfer`, `dns_exfil`, `python_http`

**`BACKDOOR_PATTERNS: BackdoorPattern[]`**

12 patterns for detecting persistence and backdoor mechanisms:

`eval`, `reverse_shell`, `cron_persistence`, `ssh_key_injection`, `env_override`, `package_script`, `docker_privileged`, `hidden_process`, `dns_rebinding`, `webshell`, `binary_download`, `setuid`

**`RESTRICTED_NETWORKS: RestrictedNetwork[]`**

9 CIDR blocks for SSRF protection:

| Name | CIDR |
|------|------|
| `loopback` | `127.0.0.0/8` |
| `private_a` | `10.0.0.0/8` |
| `private_b` | `172.16.0.0/12` |
| `private_c` | `192.168.0.0/16` |
| `link_local` | `169.254.0.0/16` |
| `aws_metadata` | `169.254.169.254/32` |
| `cgnat` | `100.64.0.0/10` |
| `documentation` | `192.0.2.0/24` |
| `ipv6_mapped` | `::ffff:0:0/96` |

---

## Tenancy Modules (Solution 1 — Retail Isolated)

### TenantManager

**Source:** `src/tenancy/tenant-manager.ts`

Full tenant lifecycle management: creation, plan assignment, suspension, deletion, and agent configuration generation.

#### Types

```typescript
type Tenant = {
  id: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  plan: "starter" | "professional" | "enterprise";
  createdAt: number;
  config: TenantConfig;
  agents: string[];
};

type TenantConfig = {
  maxAgents: number;
  maxStorageMb: number;
  allowedModels: string[];
  networkPolicy: {
    urlWhitelist: string[];
    urlBlacklist: string[];
  };
};
```

#### Class: TenantManager

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { dataDir?: string })` | Initialize with optional data directory for tenant storage. |
| `createTenant` | `createTenant(name: string, plan: Tenant["plan"]): Tenant` | Create a new tenant with a generated ID and directory structure (workspace/, logs/, credentials/, billing/). Plan determines resource limits. |
| `getTenant` | `getTenant(tenantId: string): Tenant \| undefined` | Retrieve a tenant by ID. |
| `listTenants` | `listTenants(filter?: { status?: Tenant["status"]; plan?: Tenant["plan"] }): Tenant[]` | List all tenants with optional status and plan filters. |
| `updateTenant` | `updateTenant(tenantId: string, updates: Partial<Pick<Tenant, "name" \| "config">>): Tenant` | Update tenant name and/or configuration. |
| `suspendTenant` | `suspendTenant(tenantId: string): Tenant` | Suspend a tenant, preventing agent execution. |
| `resumeTenant` | `resumeTenant(tenantId: string): Tenant` | Resume a suspended tenant. |
| `deleteTenant` | `deleteTenant(tenantId: string): Tenant` | Soft delete a tenant (marks status as "deleted"). |
| `hardDeleteTenant` | `hardDeleteTenant(tenantId: string): boolean` | Permanently remove all tenant data. Returns `true` on success. |
| `generateAgentConfig` | `generateAgentConfig(tenantId: string, agentTemplate: string): Record<string, unknown>` | Generate an agent configuration from a template, scoped to the tenant's workspace and policy. |

---

### TenantIsolation

**Source:** `src/tenancy/tenant-isolation.ts`

Composes filesystem, network, and credential isolation for a tenant. Each tenant operates within a sandboxed environment enforced at multiple layers.

#### Types

```typescript
type IsolationCheckResult = {
  allowed: boolean;
  reason?: string;
};

type SandboxEnv = {
  env: Record<string, string>;
  workspaceRoot: string;
  networkPolicy: NetworkPolicy;
  filesystemPolicy: FilesystemPolicy;
};
```

#### Class: TenantIsolation

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(tenant: Tenant)` | Initialize isolation for a tenant. Composes `FilesystemPolicy` (scoped to tenant workspace root), `NetworkPolicy` (tenant URL allowlist/blocklist), and `CredentialVault` (tenant-scoped credentials). |
| `checkFileAccess` | `checkFileAccess(path: string, operation: "read" \| "write" \| "delete"): IsolationCheckResult` | Check whether a file operation is allowed within the tenant's workspace. |
| `checkNetworkAccess` | `checkNetworkAccess(url: string): IsolationCheckResult` | Check whether a URL is allowed by the tenant's network policy. |
| `checkExecCommand` | `checkExecCommand(command: string): IsolationCheckResult` | Check whether an exec command is allowed by the tenant's policies. |
| `getCredential` | `getCredential(agentId: string, key: string, level: AgentHierarchyLevel): string \| undefined` | Retrieve a credential from the tenant's vault if the agent is authorized. |
| `verifyIsolation` | `verifyIsolation(): { passed: boolean; checks: Array<{ name: string; passed: boolean }> }` | Run all isolation verification checks and report results. |
| `createSandboxEnv` | `createSandboxEnv(agentId: string, level: AgentHierarchyLevel): SandboxEnv` | Create a complete sandbox environment for an agent, including environment variables, workspace root, and policy instances. |

---

### TenantBilling

**Source:** `src/tenancy/tenant-billing.ts`

Per-tenant budget enforcement with daily and monthly limits, automatic model downgrade on daily budget exhaustion, and invoice generation.

#### Types

```typescript
type BudgetStatus = {
  withinBudget: boolean;
  dailySpend: number;
  dailyLimit: number;
  monthlySpend: number;
  monthlyLimit: number;
  shouldBlock: boolean;
  downgradeTo?: string;
};

type Invoice = {
  tenantId: string;
  period: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
};
```

#### Class: TenantBilling

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(tenantId: string, config?: { dailyBudget?: number; monthlyBudget?: number; costTracker?: CostTracker })` | Initialize billing for a tenant with optional budget limits and cost tracker. |
| `trackRequest` | `trackRequest(agentId: string, model: string, inputTokens: number, outputTokens: number): void` | Record a request's token usage and cost against the tenant's budget. |
| `checkBudget` | `checkBudget(): BudgetStatus` | Check budget status. If monthly budget exceeded: `shouldBlock = true`. If daily budget exceeded: `downgradeTo = "claude-haiku-3-5"`. |
| `getDailyCost` | `getDailyCost(): number` | Return total cost for the current day. |
| `getMonthlyCost` | `getMonthlyCost(): number` | Return total cost for the current month. |
| `generateInvoice` | `generateInvoice(period: string): Invoice` | Generate a detailed invoice for the specified period. |
| `generateMonthlyInvoice` | `generateMonthlyInvoice(): Invoice` | Generate an invoice for the current month. |
| `willExceedBudget` | `willExceedBudget(estimatedCost: number): boolean` | Check whether an estimated cost would exceed remaining budget. |

---

### AgentTemplateRegistry

**Source:** `src/tenancy/agent-templates.ts`

Pre-built agent templates for common use cases. Templates define model, system prompt, tools, and optional webhook configurations.

#### Types

```typescript
type AgentTemplate = {
  id: string;
  name: string;
  description: string;
  category: "customer-service" | "operations" | "analytics" | "sales";
  defaultModel: string;
  systemPrompt: string;
  tools: string[];
  webhooks?: WebhookConfig[];
};
```

#### Class: AgentTemplateRegistry

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor()` | Initialize with 6 built-in templates: customer-service, inventory-assistant, scheduling-coordinator, reporting-analyst, product-recommender, returns-processor. |
| `getTemplate` | `getTemplate(templateId: string): AgentTemplate \| undefined` | Retrieve a template by ID. |
| `listTemplates` | `listTemplates(category?: AgentTemplate["category"]): AgentTemplate[]` | List all templates, optionally filtered by category. |
| `customizeTemplate` | `customizeTemplate(templateId: string, overrides: Partial<AgentTemplate>): AgentTemplate` | Create a customized copy of a template with the provided overrides. |
| `generateAgentConfig` | `generateAgentConfig(template: AgentTemplate, tenantId: string): Record<string, unknown>` | Generate a complete agent configuration from a template, scoped to a tenant. |
| `validateWebhooks` | `validateWebhooks(webhooks: WebhookConfig[]): { valid: boolean; errors: string[] }` | Validate webhook configurations for URL format and required fields. |
| `recommendTemplates` | `recommendTemplates(description: string): AgentTemplate[]` | Recommend templates based on keyword matching against a natural language description. |

---

### TenantDashboard

**Source:** `src/tenancy/tenant-dashboard.ts`

Operational dashboard providing real-time snapshots, health assessments, budget forecasting, and usage analytics for a tenant.

#### Types

```typescript
type DashboardSnapshot = {
  tenantId: string;
  timestamp: number;
  agentCount: number;
  activeAgents: number;
  dailyCost: number;
  monthlyCost: number;
  requestsToday: number;
  errorRate: number;
  topAgents: Array<{ id: string; requests: number; cost: number }>;
};

type HealthAssessment = {
  status: "healthy" | "degraded" | "critical";
  issues: string[];
  recommendations: string[];
};
```

#### Class: TenantDashboard

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(tenantId: string, config?: { billing?: TenantBilling })` | Initialize for a tenant with optional billing integration. |
| `getSnapshot` | `getSnapshot(): DashboardSnapshot` | Return a point-in-time snapshot of tenant activity, costs, and top agents. |
| `assessHealth` | `assessHealth(): HealthAssessment` | Assess tenant health based on error rate, budget usage, and agent activity. Returns status with issues and recommendations. |
| `createAlert` | `createAlert(type: string, message: string, severity: "info" \| "warning" \| "critical"): void` | Create an alert for the tenant. |
| `generateUsageTrend` | `generateUsageTrend(days?: number): Array<{ date: string; cost: number; requests: number }>` | Generate a daily usage trend over the specified number of days. |
| `generateAgentComparison` | `generateAgentComparison(): Array<{ agentId: string; requests: number; cost: number; errorRate: number }>` | Compare all agents by request volume, cost, and error rate. |
| `generateCostBreakdown` | `generateCostBreakdown(): Array<{ model: string; cost: number; percentage: number }>` | Break down costs by model with percentage of total. |
| `getBudgetForecast` | `getBudgetForecast(): { projectedMonthlyCost: number; projectedOverage: number; daysUntilBudgetExhausted: number }` | Project monthly cost, overage, and days until budget exhaustion based on current run rate. |
| `getSummaryStats` | `getSummaryStats(): { totalRequests: number; totalCost: number; avgResponseTime: number; uptime: number }` | Return aggregate summary statistics. |

---

## Corporate Modules (Solution 2 — Corporate Pyramidal)

### HierarchyManager

**Source:** `src/corporate/hierarchy-manager.ts`

Organizational tree management for corporate agent deployments. Supports arbitrary depth hierarchies with capability delegation along reporting chains.

#### Types

```typescript
type OrgNode = {
  agentId: string;
  role: string;
  department: string;
  level: number;
  parentId?: string;
  capabilities: string[];
  delegatedCapabilities: Map<string, string>;
};
```

#### Class: HierarchyManager

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { maxDepth?: number })` | Initialize with optional maximum tree depth (default: 10). |
| `addAgent` | `addAgent(agentId: string, role: string, department: string, parentId?: string): OrgNode` | Add an agent to the organizational tree. Agents without a `parentId` become root nodes. |
| `removeAgent` | `removeAgent(agentId: string): boolean` | Remove an agent from the tree. Returns `true` if the agent existed. |
| `getAgent` | `getAgent(agentId: string): OrgNode \| undefined` | Retrieve an agent's organizational node. |
| `getReportingChain` | `getReportingChain(agentId: string): OrgNode[]` | Return the reporting chain from the specified agent up to the root. |
| `getDirectReports` | `getDirectReports(agentId: string): OrgNode[]` | Return all agents that directly report to the specified agent. |
| `getAllReports` | `getAllReports(agentId: string): OrgNode[]` | Recursively return all descendants of the specified agent. |
| `delegateCapability` | `delegateCapability(fromAgentId: string, toAgentId: string, capability: string): boolean` | Delegate a capability from one agent to another. Both agents must be in the same reporting chain. |
| `revokeDelegation` | `revokeDelegation(fromAgentId: string, toAgentId: string, capability: string): boolean` | Revoke a previously delegated capability. |
| `hasCapability` | `hasCapability(agentId: string, capability: string): boolean` | Check whether an agent has a capability, either directly assigned or delegated. |
| `getCommonAncestor` | `getCommonAncestor(agentId1: string, agentId2: string): OrgNode \| undefined` | Find the lowest common ancestor of two agents in the hierarchy. |
| `exportTree` | `exportTree(): Record<string, unknown>` | Export the full organizational chart as a nested object. |

---

### ApprovalWorkflow

**Source:** `src/corporate/approval-workflow.ts`

Multi-stage approval routing with escalation, timeouts, and full audit trails. Integrates with the hierarchy for automatic escalation chains.

#### Types

```typescript
type ApprovalRequest = {
  id: string;
  requesterId: string;
  type: string;
  description: string;
  status: "pending" | "approved" | "denied" | "escalated" | "expired";
  approvers: string[];
  currentApproverIndex: number;
  createdAt: number;
  timeout: number;
  auditTrail: ApprovalEvent[];
};

type ApprovalEvent = {
  timestamp: number;
  actorId: string;
  action: "created" | "approved" | "denied" | "escalated" | "expired";
  comment?: string;
};
```

#### Class: ApprovalWorkflow

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { defaultTimeout?: number; hierarchyManager?: HierarchyManager })` | Initialize with optional default timeout (default: 24 hours / 86,400,000 ms) and hierarchy manager for escalation chains. |
| `createRequest` | `createRequest(requesterId: string, type: string, description: string, approvers: string[]): ApprovalRequest` | Create a new approval request routed to the specified approver chain. |
| `approve` | `approve(requestId: string, approverId: string, comment?: string): ApprovalRequest` | Approve a request. Only the current approver in the chain can approve. |
| `deny` | `deny(requestId: string, approverId: string, comment?: string): ApprovalRequest` | Deny a request with an optional comment. |
| `escalate` | `escalate(requestId: string): ApprovalRequest` | Manually escalate a request to the next approver in the chain. |
| `processTimeouts` | `processTimeouts(): ApprovalRequest[]` | Process all pending requests and auto-escalate those that have exceeded their timeout. Returns the list of escalated requests. |
| `getPendingRequests` | `getPendingRequests(approverId?: string): ApprovalRequest[]` | Retrieve pending requests, optionally filtered to a specific approver. |
| `getAuditTrail` | `getAuditTrail(requestId: string): ApprovalEvent[]` | Retrieve the full audit trail for a request. |

---

### DepartmentIsolation

**Source:** `src/corporate/department-isolation.ts`

Department-level data isolation with shared-read zones and cross-department access request workflows.

#### Types

```typescript
type Department = {
  id: string;
  name: string;
  headAgentId: string;
  members: string[];
  sharedReadZones: string[];
};

type CrossDepartmentRequest = {
  id: string;
  fromDepartment: string;
  toDepartment: string;
  type: "data_read" | "agent_access" | "shared_resource";
  status: "pending" | "approved" | "denied";
};
```

#### Class: DepartmentIsolation

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor()` | Initialize with an empty department registry. |
| `createDepartment` | `createDepartment(id: string, name: string, headAgentId: string): Department` | Create a new department with a designated head agent. |
| `canReadFrom` | `canReadFrom(agentId: string, sourceDepartment: string): boolean` | Check whether an agent can read from a department based on shared-read zone configuration. |
| `canRequestFrom` | `canRequestFrom(fromDept: string, toDept: string): boolean` | Check whether one department can submit access requests to another. |
| `createRequest` | `createRequest(fromDept: string, toDept: string, type: CrossDepartmentRequest["type"]): CrossDepartmentRequest` | Create a cross-department access request. |
| `approveRequest` | `approveRequest(requestId: string): CrossDepartmentRequest` | Approve a pending cross-department request. |
| `executeRequest` | `executeRequest(requestId: string): { success: boolean; data?: unknown }` | Execute an approved request and return the result. |

---

### ReportingPipeline

**Source:** `src/corporate/reporting-pipeline.ts`

Metrics collection and scheduled report generation supporting markdown and JSON output formats with department-level rollups.

#### Types

```typescript
type MetricsEntry = {
  timestamp: number;
  agentId: string;
  department: string;
  metrics: Record<string, number>;
};

type ReportDefinition = {
  id: string;
  name: string;
  schedule: "daily" | "weekly" | "monthly";
  departments: string[];
  metrics: string[];
  format: "markdown" | "json";
};
```

#### Class: ReportingPipeline

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { dataDir?: string })` | Initialize with optional data directory for metrics storage. |
| `recordMetrics` | `recordMetrics(entry: MetricsEntry): void` | Append a metrics entry to the JSONL storage. |
| `registerReport` | `registerReport(definition: ReportDefinition): void` | Register a report definition for scheduled generation. |
| `generateReport` | `generateReport(reportId: string): string` | Generate a report in the configured format (markdown or JSON) with metrics rollups. |
| `getMetrics` | `getMetrics(filter: { department?: string; agentId?: string; since?: number; until?: number }): MetricsEntry[]` | Query stored metrics with optional filters. |
| `cleanupOldMetrics` | `cleanupOldMetrics(olderThanDays: number): number` | Delete metrics older than the specified number of days. Returns the count of deleted entries. |

---

### SSOBridge

**Source:** `src/corporate/sso-bridge.ts`

SAML and OIDC single sign-on integration with configurable role-to-hierarchy-level mapping and session management.

#### Types

```typescript
type SSOSession = {
  sessionId: string;
  userId: string;
  email: string;
  roles: string[];
  hierarchyLevel: number;
  expiresAt: number;
  provider: "saml" | "oidc";
};

type SAMLAssertion = {
  issuer: string;
  nameId: string;
  attributes: Record<string, string>;
  conditions: {
    notBefore: string;
    notOnOrAfter: string;
  };
};

type OIDCToken = {
  sub: string;
  email: string;
  roles: string[];
  exp: number;
  iss: string;
  aud: string;
};
```

#### Class: SSOBridge

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config: { samlConfig?: { entityId: string; certificate: string; allowedIssuers: string[] }; oidcConfig?: { clientId: string; issuer: string; audience: string }; roleMapping: Record<string, number> })` | Initialize with SAML and/or OIDC configuration and a role-to-hierarchy-level mapping. |
| `validateSAML` | `validateSAML(assertion: SAMLAssertion): SSOSession \| undefined` | Validate a SAML assertion: checks issuer against allowedIssuers, validates time conditions, and maps roles to a hierarchy level. Returns `undefined` on validation failure. |
| `validateOIDC` | `validateOIDC(token: OIDCToken): SSOSession \| undefined` | Validate an OIDC token: checks issuer, audience, expiry, and maps roles to a hierarchy level. Returns `undefined` on validation failure. |
| `getSession` | `getSession(sessionId: string): SSOSession \| undefined` | Retrieve an active SSO session by ID. |
| `revokeSession` | `revokeSession(sessionId: string): boolean` | Revoke an active session. Returns `true` if the session existed. |
| `cleanupExpiredSessions` | `cleanupExpiredSessions(): number` | Remove all expired sessions. Returns the count of removed sessions. |

---

### ComplianceExporter

**Source:** `src/corporate/compliance-exporter.ts`

Compliance evidence generation for SOC 2, HIPAA, GDPR, ISO 27001, and PCI DSS frameworks. Produces structured evidence packages and framework-specific audit exports.

#### Types

```typescript
type ComplianceFramework =
  | "soc2"
  | "hipaa"
  | "gdpr"
  | "iso27001"
  | "pci_dss";

type EvidencePackage = {
  framework: ComplianceFramework;
  generatedAt: number;
  period: { from: number; to: number };
  controls: ControlEvidence[];
  summary: string;
};

type ControlEvidence = {
  controlId: string;
  description: string;
  status: "pass" | "fail" | "partial" | "not_applicable";
  evidence: string[];
};
```

#### Class: ComplianceExporter

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { auditLogger?: AuditLogger })` | Initialize with an optional `AuditLogger` instance for evidence collection. |
| `logAudit` | `logAudit(entry: { action: string; details: Record<string, unknown> }): void` | Record a compliance-relevant audit event. |
| `generateEvidencePackage` | `generateEvidencePackage(framework: ComplianceFramework, period: { from: number; to: number }): EvidencePackage` | Generate a structured evidence package for the specified compliance framework and time period. |
| `exportHIPAALogs` | `exportHIPAALogs(period: { from: number; to: number }): string` | Export HIPAA-specific audit logs for the specified period. |
| `exportSOC2Summary` | `exportSOC2Summary(period: { from: number; to: number }): string` | Export a SOC 2 Type II summary for the specified period. |
| `registerControl` | `registerControl(framework: ComplianceFramework, control: { controlId: string; description: string; testFn: () => boolean }): void` | Register a compliance control with a test function for automated evidence generation. |

---

## Group Modules (Solution 3 — Group of Companies)

### GroupManager

**Source:** `src/group/group-manager.ts`

Multi-company management with cross-company access policies enforced via glob pattern matching. Supports company lifecycle operations and group-wide statistics.

#### Types

```typescript
type Company = {
  id: string;
  name: string;
  status: "active" | "suspended" | "archived";
  createdAt: number;
  config: CompanyConfig;
};

type CompanyConfig = {
  maxAgents: number;
  allowedModels: string[];
  dataRegion: string;
};

type CrossCompanyPolicy = {
  id: string;
  name: string;
  sourceCompany: string;
  targetCompany: string;
  accessType: "read" | "write" | "execute";
  resourcePattern: string;
};
```

#### Class: GroupManager

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { dataDir?: string })` | Initialize with optional data directory for group storage. |
| `createCompany` | `createCompany(name: string, config: CompanyConfig): Company` | Create a new company with a generated ID and the provided configuration. |
| `getCompany` | `getCompany(companyId: string): Company \| undefined` | Retrieve a company by ID. |
| `listCompanies` | `listCompanies(filter?: { status?: Company["status"] }): Company[]` | List all companies with optional status filter. |
| `suspendCompany` | `suspendCompany(companyId: string): Company` | Suspend a company, preventing its agents from executing. |
| `archiveCompany` | `archiveCompany(companyId: string): Company` | Archive a company for long-term storage. |
| `deleteCompany` | `deleteCompany(companyId: string, confirmation: string): boolean` | Permanently delete a company. The `confirmation` parameter must match the company name exactly. |
| `createPolicy` | `createPolicy(policy: Omit<CrossCompanyPolicy, "id">): CrossCompanyPolicy` | Create a cross-company access policy with glob pattern matching on resources. |
| `isAccessAllowed` | `isAccessAllowed(sourceCompany: string, targetCompany: string, resource: string, accessType: CrossCompanyPolicy["accessType"]): boolean` | Check whether access is allowed based on matching cross-company policies. Uses glob pattern matching on `resourcePattern`. |
| `getGroupStats` | `getGroupStats(): { totalCompanies: number; activeCompanies: number; totalPolicies: number }` | Return aggregate statistics for the group. |

---

### CompanyEnvironment

**Source:** `src/group/company-environment.ts`

Isolated runtime environment per company with agent pool management, data sovereignty enforcement, and workspace sandboxing.

#### Types

```typescript
type CompanyRuntime = {
  companyId: string;
  workspaceRoot: string;
  agentPool: Map<string, AgentInstance>;
  config: CompanyConfig;
};

type AgentInstance = {
  agentId: string;
  status: "idle" | "active" | "error";
  lastActivity: number;
};
```

#### Class: CompanyEnvironment

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(companyId: string, config: CompanyConfig, baseDir?: string)` | Create an isolated workspace for the company under the specified base directory. |
| `activateAgent` | `activateAgent(agentId: string): AgentInstance` | Activate an agent in the company's pool. |
| `deactivateAgent` | `deactivateAgent(agentId: string): boolean` | Deactivate an agent. Returns `true` if the agent existed. |
| `getAgent` | `getAgent(agentId: string): AgentInstance \| undefined` | Retrieve an agent instance from the pool. |
| `listAgents` | `listAgents(): AgentInstance[]` | List all agent instances in the company's pool. |
| `isEndpointAllowed` | `isEndpointAllowed(endpoint: string): boolean` | Check whether an endpoint is in the company's allowed endpoint list. |
| `canDataLeaveRegion` | `canDataLeaveRegion(targetRegion: string): boolean` | Data sovereignty check: returns `true` only if the target region matches the company's configured `dataRegion`. |
| `isPathInWorkspace` | `isPathInWorkspace(path: string): boolean` | Check whether a path resolves within the company's workspace root. |
| `getSafePath` | `getSafePath(relativePath: string): string` | Resolve a relative path to an absolute path within the workspace root. |
| `getDiskUsage` | `getDiskUsage(): { totalBytes: number; limitBytes: number; usagePercent: number }` | Return current disk usage statistics for the company's workspace. |

---

### SharedServiceRegistry

**Source:** `src/group/shared-service-registry.ts`

Cross-company shared service management with concurrency limits, access control, and usage tracking.

#### Types

```typescript
type SharedService = {
  id: string;
  name: string;
  ownerCompany: string;
  type: "agent" | "model" | "tool" | "data";
  maxConcurrency: number;
  currentUsage: number;
  authorizedCompanies: string[];
};

type UsageRecord = {
  serviceId: string;
  companyId: string;
  timestamp: number;
  duration: number;
  cost: number;
};
```

#### Class: SharedServiceRegistry

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor()` | Initialize with an empty service registry. |
| `registerService` | `registerService(service: Omit<SharedService, "id" \| "currentUsage">): SharedService` | Register a new shared service with a generated ID and initial usage of 0. |
| `getService` | `getService(serviceId: string): SharedService \| undefined` | Retrieve a service by ID. |
| `listServices` | `listServices(companyId?: string): SharedService[]` | List all services, optionally filtered to those a specific company is authorized to use. |
| `canCompanyUseService` | `canCompanyUseService(companyId: string, serviceId: string): boolean` | Check whether a company is authorized to use a service. |
| `grantAccess` | `grantAccess(serviceId: string, companyId: string): boolean` | Grant a company access to a shared service. |
| `revokeAccess` | `revokeAccess(serviceId: string, companyId: string): boolean` | Revoke a company's access to a shared service. |
| `acquireRequest` | `acquireRequest(serviceId: string, companyId: string): boolean` | Acquire a concurrency slot for a service. Returns `false` if the service is at maximum concurrency. |
| `releaseRequest` | `releaseRequest(serviceId: string): void` | Release a concurrency slot, decrementing the service's current usage count. |
| `recordUsage` | `recordUsage(record: Omit<UsageRecord, "timestamp">): void` | Record a usage entry with an auto-generated timestamp. |
| `getCompanyUsageBreakdown` | `getCompanyUsageBreakdown(companyId: string): Map<string, { totalDuration: number; totalCost: number; requestCount: number }>` | Return per-service usage breakdown for a company. |
| `getMostUsedServices` | `getMostUsedServices(limit?: number): Array<{ serviceId: string; totalRequests: number; totalCost: number }>` | Return the most-used services sorted by request count. |

---

### CrossCompanyBus

**Source:** `src/group/cross-company-bus.ts`

Asynchronous inter-company messaging with optional approval gates, conversation threading, and per-company audit trails.

#### Types

```typescript
type BusMessage = {
  id: string;
  fromCompany: string;
  toCompany: string;
  type: "request" | "response" | "notification";
  payload: unknown;
  status: "pending_approval" | "approved" | "rejected" | "delivered";
  createdAt: number;
  approvedBy?: string;
  threadId?: string;
};
```

#### Class: CrossCompanyBus

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { requireApproval?: boolean })` | Initialize with optional approval requirement (default: `true`). When enabled, all messages require explicit approval before delivery. |
| `sendMessage` | `sendMessage(fromCompany: string, toCompany: string, type: BusMessage["type"], payload: unknown, threadId?: string): BusMessage` | Send a message between companies. If approval is required, the message starts in `pending_approval` status. |
| `approveMessage` | `approveMessage(messageId: string, approverId: string): BusMessage` | Approve a pending message for delivery. |
| `rejectMessage` | `rejectMessage(messageId: string, approverId: string, reason?: string): BusMessage` | Reject a pending message with an optional reason. |
| `markDelivered` | `markDelivered(messageId: string): BusMessage` | Mark an approved message as delivered. |
| `sendResponse` | `sendResponse(originalMessageId: string, payload: unknown): BusMessage` | Send a response to an existing message. Automatically links to the original message's thread. |
| `getConversationThread` | `getConversationThread(threadId: string): BusMessage[]` | Retrieve all messages in a conversation thread. |
| `getPendingMessages` | `getPendingMessages(companyId?: string): BusMessage[]` | Retrieve pending messages, optionally filtered to a specific company. |
| `getCompanyAuditTrail` | `getCompanyAuditTrail(companyId: string): BusMessage[]` | Retrieve all messages sent to or from a company. |
| `getCompanyStats` | `getCompanyStats(companyId: string): { sent: number; received: number; pending: number; rejected: number }` | Return message statistics for a company. |

---

### ConsolidatedBilling

**Source:** `src/group/consolidated-billing.ts`

Group-level billing with per-company budgets, inter-company cost allocations, and consolidated invoice generation.

#### Types

```typescript
type CompanyBudget = {
  companyId: string;
  monthlyLimit: number;
  currentSpend: number;
  allocations: Map<string, number>;
};

type GroupInvoice = {
  period: string;
  companies: Array<{
    companyId: string;
    subtotal: number;
    lineItems: Array<{ description: string; amount: number }>;
  }>;
  interCompanyAllocations: Array<{
    from: string;
    to: string;
    amount: number;
    description: string;
  }>;
  groupTotal: number;
};
```

#### Class: ConsolidatedBilling

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor()` | Initialize with empty company budgets. |
| `recordCost` | `recordCost(companyId: string, description: string, amount: number): void` | Record a cost against a company's budget. |
| `setCompanyBudget` | `setCompanyBudget(companyId: string, monthlyLimit: number): void` | Set or update the monthly budget for a company. |
| `checkBudgetStatus` | `checkBudgetStatus(companyId: string): { withinBudget: boolean; currentSpend: number; monthlyLimit: number; remainingBudget: number; usagePercent: number }` | Check a company's current budget status. |
| `canCompanySpend` | `canCompanySpend(companyId: string, amount: number): boolean` | Check whether a company can afford an additional expenditure. |
| `allocateCost` | `allocateCost(fromCompany: string, toCompany: string, amount: number, description: string): void` | Record an inter-company cost transfer. |
| `getGroupSummary` | `getGroupSummary(): { totalSpend: number; companyBreakdown: Map<string, number>; topSpenders: Array<{ companyId: string; spend: number }> }` | Return group-wide spending summary. |
| `generateInvoice` | `generateInvoice(period: string): GroupInvoice` | Generate a consolidated group invoice for the specified period, including per-company line items and inter-company allocations. |

---

### VersionManager

**Source:** `src/group/version-manager.ts`

Multi-company version pinning, staged rollouts, and canary deployments with metrics-based pass/fail evaluation.

#### Types

```typescript
type VersionPin = {
  companyId: string;
  version: string;
  pinnedAt: number;
  pinnedBy: string;
};

type RolloutStage = {
  name: string;
  companies: string[];
  status: "pending" | "in_progress" | "completed" | "failed";
  startedAt?: number;
  completedAt?: number;
};

type Rollout = {
  id: string;
  version: string;
  stages: RolloutStage[];
  currentStage: number;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
};

type CanaryDeployment = {
  id: string;
  version: string;
  companyId: string;
  percentage: number;
  startedAt: number;
  metrics: {
    requests: number;
    errors: number;
    latencyP50: number;
    latencyP99: number;
  };
  status: "active" | "passed" | "failed";
};
```

#### Class: VersionManager

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor()` | Initialize with empty version pins, rollouts, and canary deployments. |
| `pinCompanyVersion` | `pinCompanyVersion(companyId: string, version: string, pinnedBy: string): VersionPin` | Pin a specific version for a company. |
| `getCompanyVersion` | `getCompanyVersion(companyId: string): VersionPin \| undefined` | Retrieve the current version pin for a company. |
| `createRollout` | `createRollout(version: string, stages: Array<{ name: string; companies: string[] }>): Rollout` | Create a staged rollout plan. |
| `startRollout` | `startRollout(rolloutId: string): Rollout` | Start the first stage of a rollout. |
| `completeRolloutStage` | `completeRolloutStage(rolloutId: string): Rollout` | Mark the current stage as completed and advance to the next stage. |
| `failRolloutStage` | `failRolloutStage(rolloutId: string, reason: string): Rollout` | Mark the current stage as failed and halt the rollout. |
| `createCanary` | `createCanary(version: string, companyId: string, percentage: number): CanaryDeployment` | Create a canary deployment directing a percentage of traffic to the new version. |
| `updateCanaryMetrics` | `updateCanaryMetrics(canaryId: string, metrics: Partial<CanaryDeployment["metrics"]>): CanaryDeployment` | Update metrics for an active canary deployment. |
| `passCanary` | `passCanary(canaryId: string): CanaryDeployment` | Mark a canary deployment as passed. |
| `failCanary` | `failCanary(canaryId: string): CanaryDeployment` | Mark a canary deployment as failed. |
| `checkCanaries` | `checkCanaries(): CanaryDeployment[]` | Return all active canary deployments that should be evaluated. |

---

## Billing Modules

### CostTracker

**Source:** `src/billing/cost-tracker.ts`

Token-level cost tracking with daily JSONL storage, per-agent and per-model breakdowns, and budget enforcement with automatic model downgrade.

#### Types

```typescript
type UsageEntry = {
  timestamp: number;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

type BudgetCheck = {
  withinBudget: boolean;
  dailySpend: number;
  dailyLimit: number;
  shouldBlock: boolean;
  downgradeTo?: string;
};

type AgentUsageSummary = {
  agentId: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  models: Record<string, number>;
};
```

#### Class: CostTracker

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: { dataDir?: string; dailyBudget?: number; monthlyBudget?: number })` | Initialize with optional data directory and budget limits. |
| `trackRequest` | `trackRequest(agentId: string, model: string, inputTokens: number, outputTokens: number): UsageEntry` | Record a request's token usage and computed cost. Writes to `usage-YYYY-MM-DD.jsonl`. |
| `checkBudget` | `checkBudget(agentId?: string): BudgetCheck` | Check budget status. If monthly budget exceeded: `shouldBlock = true`. If daily budget exceeded: `downgradeTo = "claude-haiku-3-5"`. |
| `getDailyCost` | `getDailyCost(date?: string): number` | Return total cost for a specific date (default: today). |
| `getTotalDailyCost` | `getTotalDailyCost(): number` | Return today's total cost across all agents. |
| `getDailyCostByAgent` | `getDailyCostByAgent(date?: string): Map<string, number>` | Return cost breakdown by agent for a specific date. |
| `getDailyCostByModel` | `getDailyCostByModel(date?: string): Map<string, number>` | Return cost breakdown by model for a specific date. |
| `getAgentUsageSummary` | `getAgentUsageSummary(agentId: string, days?: number): AgentUsageSummary` | Return aggregate usage summary for an agent over the specified number of days. |

---

### Cost Models

**Source:** `src/billing/cost-models.ts`

Model pricing lookup and request cost calculation. This module exports functions only (no class).

#### Types

```typescript
type ModelPricing = {
  model: string;
  provider: "anthropic" | "openai" | "google" | "local";
  inputPer1k: number;
  outputPer1k: number;
};
```

#### Exported Functions

```typescript
function getModelPricing(model: string): ModelPricing | undefined;
```

Look up pricing for a model. Supported models:

| Model | Provider |
|-------|----------|
| `claude-opus-4-6` | Anthropic |
| `claude-sonnet-4-5` | Anthropic |
| `claude-sonnet-4-6` | Anthropic |
| `claude-haiku-3-5` | Anthropic |
| `gpt-4.1` | OpenAI |
| `gpt-4o` | OpenAI |
| `o3` | OpenAI |
| `o3-mini` | OpenAI |
| `gemini-2.5-pro` | Google |
| `gemini-2.5-flash` | Google |
| `ollama/*` | Local ($0.00) |

```typescript
function calculateRequestCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number;
```

Calculate the cost of a single request based on the model's per-1k-token pricing.

---

## Health Module

### AutoHealer

**Source:** `src/health/auto-healer.ts`

Automated issue diagnosis and remediation with exponential backoff, cooldowns, and escalation callbacks.

#### Types

```typescript
type IssueType =
  | "gateway_down"
  | "auth_error"
  | "backup_stale"
  | "agent_frozen"
  | "bot_token_invalid"
  | "version_outdated"
  | "telegram_bot_error"
  | "ssh_unreachable";

type HealResult = {
  issue: IssueType;
  success: boolean;
  action: string;
  details?: string;
};

type HealerConfig = {
  maxAttemptsPerHour?: number;
  cooldownMs?: number;
  escalationCallback?: (issue: IssueType, attempts: number) => void;
};
```

#### Class: AutoHealer

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(config?: HealerConfig)` | Initialize with optional configuration. Defaults: `maxAttemptsPerHour = 3`, `cooldownMs = 300000` (5 minutes). |
| `diagnose` | `diagnose(issue: IssueType, context?: Record<string, unknown>): Promise<HealResult>` | Run the appropriate handler for the issue type with exponential backoff. Handlers: restart gateway, refresh auth, trigger backup, restart agent, revalidate token, pull update, reset webhook, test SSH connectivity. |
| `canAttempt` | `canAttempt(issue: IssueType): boolean` | Check whether a healing attempt is allowed based on cooldown and maximum attempts per hour. |
| `getAttemptHistory` | `getAttemptHistory(issue?: IssueType): Array<{ issue: IssueType; timestamp: number; success: boolean }>` | Retrieve the history of healing attempts, optionally filtered by issue type. |
| `resetCooldowns` | `resetCooldowns(): void` | Reset all cooldown timers, allowing immediate healing attempts. |

---

## Agent Permissions

### AgentPermissions

**Source:** `src/agents/agent-permissions.ts`

Static permission checks for the three-level agent hierarchy: admin (0), lead (1), and worker (2).

#### Types

```typescript
type AgentHierarchyLevel = 0 | 1 | 2;

type PermissionSet = {
  canSSH: boolean;
  canAccessCredentials: boolean;
  canWriteCredentials: boolean;
  canRestartGateway: boolean;
  canSpawnSubagent: boolean;
  canSendToAgent: "all" | "same_and_below" | "same_only";
};
```

#### Class: AgentPermissions (static methods)

| Method | Signature | Description |
|--------|-----------|-------------|
| `canSSH` | `static canSSH(level: AgentHierarchyLevel): boolean` | Returns `true` for level 0 (admin) only. |
| `canAccessCredentials` | `static canAccessCredentials(level: AgentHierarchyLevel): boolean` | Returns `true` for levels 0 (admin) and 1 (lead). |
| `canWriteCredentials` | `static canWriteCredentials(level: AgentHierarchyLevel): boolean` | Returns `true` for level 0 (admin) only. |
| `canRestartGateway` | `static canRestartGateway(level: AgentHierarchyLevel): boolean` | Returns `true` for level 0 (admin) only. |
| `canSpawnSubagent` | `static canSpawnSubagent(level: AgentHierarchyLevel): boolean` | Returns `true` for levels 0 (admin) and 1 (lead). |
| `canSendToAgent` | `static canSendToAgent(level: AgentHierarchyLevel): "all" \| "same_and_below" \| "same_only"` | Level 0: `"all"`. Level 1: `"same_and_below"`. Level 2: `"same_only"`. |
| `getLevel` | `static getLevel(agentId: string, config: Record<string, AgentHierarchyLevel>): AgentHierarchyLevel` | Look up an agent's hierarchy level from the config map. Returns 2 (worker) as the default if not found. |
| `validateHierarchy` | `static validateHierarchy(config: Record<string, AgentHierarchyLevel>): { valid: boolean; errors: string[] }` | Validate that the hierarchy configuration contains at least one admin (level 0). |

#### Exported Constant

```typescript
const DEFAULT_PERMISSIONS: Record<AgentHierarchyLevel, PermissionSet>;
```

Complete permission matrix for all three hierarchy levels:

| Permission | Admin (0) | Lead (1) | Worker (2) |
|------------|-----------|----------|------------|
| `canSSH` | `true` | `false` | `false` |
| `canAccessCredentials` | `true` | `true` | `false` |
| `canWriteCredentials` | `true` | `false` | `false` |
| `canRestartGateway` | `true` | `false` | `false` |
| `canSpawnSubagent` | `true` | `true` | `false` |
| `canSendToAgent` | `"all"` | `"same_and_below"` | `"same_only"` |

---

## Smart Router

### SmartRouter

**Source:** `src/routing/smart-router.ts`

Intelligent request routing across Claude Code and API instances with rate limit tracking, automatic failover, and queueing.

#### Types

```typescript
type ClaudeInstance = {
  id: string;
  name: string;
  type: "claude-code" | "api";
  rateLimited: boolean;
  rateLimitResetAt?: number;
  requestCount: number;
  lastRequestAt?: number;
};

type RouteResult = {
  instance: ClaudeInstance;
  method: "claude-code" | "api" | "queued" | "failed";
  waitTime?: number;
  reason?: string;
};
```

#### Class: SmartRouter

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `constructor(instances: Array<{ id: string; name: string; type: ClaudeInstance["type"] }>)` | Initialize with a list of available Claude instances. |
| `findAvailableInstance` | `findAvailableInstance(preferType?: ClaudeInstance["type"]): ClaudeInstance \| undefined` | Find a non-rate-limited instance, preferring the specified type if provided. |
| `markRateLimited` | `markRateLimited(instanceId: string): void` | Mark an instance as rate-limited. The rate limit automatically resets after 5 hours. |
| `markRequestComplete` | `markRequestComplete(instanceId: string): void` | Record a completed request on an instance. |
| `route` | `route(preferFree?: boolean): RouteResult` | Route a request to the best available instance. When `preferFree` is `true`: tries Claude Code instances first, falls back to API instances, then queues. Returns the routing method and estimated wait time. |
| `getStatus` | `getStatus(): Array<{ id: string; name: string; type: string; available: boolean; requestCount: number; rateLimitResetAt?: number }>` | Return the current status of all instances. |
| `getNextAvailableTime` | `getNextAvailableTime(): number` | Return the earliest timestamp at which any rate-limited instance becomes available. |
