# Migration Guide

## Overview
This guide covers migrating from vanilla OpenClaw to the enterprise fork. The fork is additive — it adds new modules without modifying upstream core. Migration is straightforward because no upstream files are changed.

## Prerequisites
- Existing OpenClaw installation
- Node 22+
- Git access to fork repository
- Backup of current configuration and data

## Migration Steps

### Step 1: Backup Current Installation
```bash
# Backup config
cp -r ~/.openclaw ~/.openclaw.backup

# Backup any custom agents
cp -r /path/to/agents /path/to/agents.backup

# Note current version
openclaw --version
```

### Step 2: Clone the Fork
```bash
git clone https://github.com/VladyslavtechAI/openclaw.git openclaw-fork
cd openclaw-fork
git checkout feature/security-phase0
```

### Step 3: Install Dependencies
```bash
pnpm install
# or
npm install
```

### Step 4: Run Tests to Verify
```bash
# Run all fork-specific tests (488 tests)
npx vitest run src/security/ src/billing/ src/health/ src/agents/ src/routing/

# Expected: 488 tests passing
# - 116 security tests
# - 372 infrastructure tests
```

### Step 5: Build
```bash
npm run build
```

### Step 6: Configure Agent Hierarchy

Create agent hierarchy configuration matching your agents:

```typescript
import { AgentPermissions } from "./agents/agent-permissions.js";

// Define hierarchy levels for your agents
const agentConfig: Record<string, 0 | 1 | 2> = {
  // Level 0 — Admin (SSH, all credentials, gateway restart)
  "jarvis": 0,
  "rex": 0,

  // Level 1 — Lead (credential read, spawn subagents)
  "vs-assistant": 1,
  "justin": 1,
  "bob": 1,
  "bolito": 1,

  // Level 2 — Worker (basic tools only)
  "trinity": 2,
  "stark": 2,
  "boris": 2,
  "maximus": 2,
  "creator": 2,
};

// Validate (at least one admin required)
const validation = AgentPermissions.validateHierarchy(agentConfig);
if (!validation.valid) {
  console.error("Hierarchy errors:", validation.errors);
}
```

### Step 7: Configure Security Modules

```typescript
import { InjectionShield } from "./security/injection-shield.js";
import { NetworkPolicy } from "./security/network-policy.js";
import { DlpEngine } from "./security/dlp-engine.js";
import { ExfilGuard } from "./security/exfil-guard.js";
import { FilesystemPolicy } from "./security/filesystem-policy.js";
import { AuditLogger } from "./security/audit-logger.js";
import { CredentialVault } from "./security/credential-vault.js";

// Initialize security stack
const shield = new InjectionShield();
const network = new NetworkPolicy({
  urlWhitelist: ["api.anthropic.com", "api.openai.com"],
});
const dlp = new DlpEngine();
const exfil = new ExfilGuard({ blockThreshold: 0.7 });
const filesystem = new FilesystemPolicy({ workspaceRoot: "/data/workspace" });
const audit = new AuditLogger({ logDir: "/data/audit", scrubSecrets: true });
const vault = new CredentialVault({
  credentials: [
    { key: "ANTHROPIC_API_KEY", value: "sk-ant-...", minLevel: 0 },
    { key: "GITHUB_TOKEN", value: "ghp_...", minLevel: 1, allowedAgents: ["jarvis", "rex"] },
  ],
});
```

### Step 8: Configure Cost Tracking

```typescript
import { CostTracker } from "./billing/cost-tracker.js";

const tracker = new CostTracker({
  dataDir: "/data/billing",
  dailyBudget: 100,    // $100/day across all agents
  monthlyBudget: 2000, // $2000/month
});

// Track each request
tracker.trackRequest("jarvis", "claude-sonnet-4-5", 1000, 500);

// Check budget before expensive requests
const budget = tracker.checkBudget();
if (budget.shouldBlock) {
  console.error("Monthly budget exceeded!");
} else if (budget.downgradeTo) {
  console.log(`Over daily budget, downgrading to ${budget.downgradeTo}`);
}
```

### Step 9: Configure Smart Router

```typescript
import { SmartRouter } from "./routing/smart-router.js";

const router = new SmartRouter([
  { id: "sub-1", name: "Claude Max #1", type: "claude-code" },
  { id: "sub-2", name: "Claude Max #2", type: "claude-code" },
  { id: "sub-3", name: "Claude Max #3", type: "claude-code" },
  { id: "api-1", name: "API Fallback", type: "api" },
]);

// Route requests (free first, API fallback)
const route = router.route(true); // preferFree = true
console.log(`Routing via ${route.method}: ${route.instance.name}`);
```

### Step 10: Start Gateway
```bash
# Stop old gateway
pkill -9 -f openclaw-gateway || true

# Start with fork
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &

# Verify
openclaw channels status --probe
ss -ltnp | grep 18789
```

## Choosing a Business Solution

After basic migration, choose and configure a business solution:

### If you need multi-tenant SaaS → Solution 1 (Retail Isolated)
See [SOLUTIONS.md](SOLUTIONS.md#solution-1--retail-isolated-multi-tenant-saas)

### If you need org hierarchy → Solution 2 (Corporate Pyramidal)
See [SOLUTIONS.md](SOLUTIONS.md#solution-2--corporate-pyramidal-hierarchical-organization)

### If you need holding company structure → Solution 3 (Group of Companies)
See [SOLUTIONS.md](SOLUTIONS.md#solution-3--group-of-companies-holding-structure)

## Feature Comparison: Before and After

| Feature | Before (Vanilla) | After (Fork) |
|---------|-------------------|--------------|
| Prompt injection protection | None | 3-layer defense (31 patterns) |
| SSRF protection | None | 9 restricted networks + cloud metadata |
| Data exfiltration prevention | None | 16 exec + message + URL patterns |
| DLP | None | 15 credential/PII/financial patterns |
| File integrity monitoring | None | SHA-256 baseline + backdoor scanning |
| Agent permissions | None | 3-tier hierarchy (admin/lead/worker) |
| Credential isolation | Shared | Per-agent with hierarchy levels |
| Cost tracking | None | Per-agent JSONL with budget enforcement |
| Auto-healing | None | 8 issue types with cooldown |
| Smart routing | None | Free-first with rate limit awareness |
| Audit logging | None | Hash-chain tamper-evident JSONL |
| Compliance | None | SOC 2, HIPAA, GDPR evidence export |

## Configuration File Locations

| Config | Path | Purpose |
|--------|------|---------|
| Agent hierarchy | src/config/types.agent-hierarchy.ts | Hierarchy type definitions |
| Billing data | /data/billing/usage-YYYY-MM-DD.jsonl | Daily cost records |
| Audit logs | /data/audit/*.jsonl | Tamper-evident audit trail |
| Secrets | Encrypted in memory (SecretsStore) | AES-256-GCM encrypted |
| Tenant data | /data/tenants/{id}/ | Per-tenant workspace |
| Company data | /data/companies/{id}/ | Per-company workspace |

## Rollback Instructions

If the fork causes issues, rollback is simple because no upstream files were modified:

### Quick Rollback (< 5 minutes)
```bash
# Stop fork gateway
pkill -9 -f openclaw-gateway || true

# Switch to upstream
git checkout upstream/main

# Reinstall deps
npm install

# Rebuild
npm run build

# Start upstream gateway
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
```

### Data Preservation During Rollback
- Billing JSONL files are preserved (fork-only, upstream ignores them)
- Audit logs are preserved (fork-only)
- Tenant/company data directories are preserved
- Upstream config (~/.openclaw/) is untouched by fork

### Re-applying Fork After Rollback
```bash
git checkout feature/security-phase0
npm install
npm run build
# Fork modules reconnect to existing data directories
```

## Gradual Migration Strategy

For production environments, migrate gradually:

1. **Week 1**: Deploy to VPS only (lowest risk). Run tests. Monitor 24h
2. **Week 2**: Deploy to one Mini machine. Monitor 48h
3. **Week 3**: Deploy to remaining Mini machines
4. **Week 4**: Deploy to Mac Studio (most critical agents)

At each stage:
```bash
# Run tests
npx vitest run src/security/ src/billing/ src/health/ src/agents/ src/routing/

# Verify gateway
openclaw channels status --probe

# Check for errors
tail -f /tmp/openclaw-gateway.log

# Monitor for 24h+ before next stage
```

## Common Migration Issues

### Issue: Tests fail with missing dependencies
```bash
# Solution: clean install
rm -rf node_modules
pnpm install
```

### Issue: TypeScript errors
```bash
# Solution: check Node version
node --version  # Must be 22+
```

### Issue: Gateway won't start
```bash
# Solution: check port
ss -ltnp | grep 18789
# Kill any process on that port
kill $(lsof -t -i:18789)
```

### Issue: Agent hierarchy validation fails
```bash
# Solution: ensure at least one admin (level 0) agent
# Check: AgentPermissions.validateHierarchy(config)
```

## Upstream Sync After Migration

The fork syncs weekly from upstream OpenClaw. Protected fork paths are preserved automatically:

```bash
# Preview changes
./scripts/sync-upstream.sh --dry-run

# Apply with auto-resolution
./scripts/sync-upstream.sh --auto-resolve
```

See [FORK_VERSION.md](../FORK_VERSION.md) for full sync strategy and merge rules.
