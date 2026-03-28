# Deployment Guide

Step-by-step deployment guide for the OpenClaw enterprise fork (`feature/security-phase0`).
This branch adds security hardening, cost tracking, health auto-healing, agent hierarchy
permissions, and smart routing on top of the upstream OpenClaw gateway.

---

## Prerequisites

| Requirement | Version / Notes |
|---|---|
| **Node.js** | 22+ (required; 24 LTS recommended for Docker) |
| **pnpm** | Preferred package manager (`corepack enable` to bootstrap) |
| **npm** | Fallback if pnpm is unavailable |
| **Git** | 2.30+ (for merge/rebase workflows) |
| **Tailscale** | Required for multi-machine mesh networking |
| **Claude Max subscriptions** | 3 accounts for SmartRouter (free Opus routing) |
| **OpenSSL** | For SecretsStore AES-256-GCM encryption |

> **WARNING:** The fork modules (`src/security/`, `src/billing/`, `src/health/`,
> `src/routing/smart-router.ts`) are security-sensitive surfaces. Do not modify
> them without review from a listed CODEOWNERS owner.

---

## Single Machine Deployment

### 1. Clone and checkout

```bash
git clone https://github.com/openclaw/openclaw.git openclaw-fork
cd openclaw-fork
git checkout feature/security-phase0
```

### 2. Install dependencies

```bash
corepack enable
pnpm install
```

### 3. Run fork module tests

```bash
npx vitest run src/security/ src/billing/ src/health/ src/agents/agent-permissions.test.ts src/routing/smart-router.test.ts
```

All tests must pass before proceeding. The fork adds 86+ security tests including
penetration tests (`src/security/penetration-tests.test.ts`).

### 4. Build

```bash
pnpm build
```

> **IMPORTANT:** If your changes affect build output, packaging, lazy-loading/module
> boundaries, or published surfaces, `pnpm build` MUST pass before deployment.

### 5. Configure environment variables

Create or update your environment file (e.g., `~/.profile` or systemd unit):

```bash
# Core directories
export OPENCLAW_DATA_DIR="$HOME/.openclaw/data"
export OPENCLAW_AUDIT_DIR="$HOME/.openclaw/audit"
export OPENCLAW_BILLING_DIR="$HOME/.openclaw/billing"

# SecretsStore encryption (AES-256-GCM via PBKDF2)
# WARNING: Store this securely. Loss means all encrypted secrets are unrecoverable.
export OPENCLAW_MASTER_PASSWORD="<strong-random-password-here>"

# SmartRouter — Claude Max subscription instances
export CLAUDE_MAX_SUBSCRIPTION_1="user1@host1"
export CLAUDE_MAX_SUBSCRIPTION_2="user2@host2"
export CLAUDE_MAX_SUBSCRIPTION_3="user3@host3"

# Tailscale (for multi-machine only)
export TAILSCALE_AUTH_KEY="tskey-auth-..."

# Budget limits
export OPENCLAW_DAILY_BUDGET_USD="50"
export OPENCLAW_MONTHLY_BUDGET_USD="1000"
```

> **SECURITY WARNING:** Never commit `OPENCLAW_MASTER_PASSWORD` or API keys to version
> control. Use a secrets manager or environment-only injection.

### 6. Start the gateway

```bash
openclaw gateway run --bind loopback --port 18789 --force
```

For background operation:

```bash
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
```

### 7. Verify

```bash
# Check gateway health
openclaw channels status --probe

# Check port binding
ss -ltnp | grep 18789

# Check logs
tail -n 120 /tmp/openclaw-gateway.log
```

---

## Multi-Machine Cluster Deployment (4 Mac + 1 VPS)

### Infrastructure Overview

| Machine | Agents | Roles |
|---|---|---|
| **Mini 1** | Jarvis (admin), VS Assistant (lead), Trinity (worker) | Primary admin node |
| **Mini 2** | Justin (lead), Stark (worker), Boris (worker), + others | Worker pool |
| **Mini 3** | Bob (lead), Maximus (worker) | Worker pool |
| **Mac Studio** | Rex (admin), Bolito (lead), Creator (worker) | Critical agents |
| **VPS** (100.102.127.45) | Gateway + monitoring | Network gateway, health checks |

### Deployment Order (lowest risk first)

Deploy machines in this order, verifying each before proceeding:

#### Step 1: VPS first (lowest risk)

```bash
ssh root@100.102.127.45
cd /root/openclaw-fork
git pull origin feature/security-phase0
pnpm install
npx vitest run src/security/ src/billing/ src/health/
pnpm build
systemctl restart openclaw-gateway
```

Verify VPS:

```bash
openclaw channels status --probe
ss -ltnp | grep 18789
tail -n 120 /tmp/openclaw-gateway.log
```

#### Step 2: Mini machines (one at a time)

Deploy to Mini 1, then Mini 2, then Mini 3. Verify each before continuing.

```bash
# SSH via Tailscale
ssh user@mini-1

cd ~/openclaw-fork
git pull origin feature/security-phase0
pnpm install
npx vitest run src/security/ src/billing/ src/health/
pnpm build

# Restart gateway
pkill -9 -f openclaw-gateway || true
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &

# Verify
openclaw channels status --probe
```

Repeat for Mini 2 and Mini 3.

#### Step 3: Mac Studio last (most critical agents)

```bash
ssh user@mac-studio

cd ~/openclaw-fork
git pull origin feature/security-phase0
pnpm install
npx vitest run src/security/ src/billing/ src/health/ src/agents/agent-permissions.test.ts
pnpm build

# Restart via the OpenClaw Mac app or:
pkill -9 -f openclaw-gateway || true
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &

# Verify
openclaw channels status --probe
```

> **NOTE:** On macOS, prefer starting/stopping the gateway via the OpenClaw Mac app
> or `scripts/restart-mac.sh`, not ad-hoc tmux sessions.

### Tailscale Mesh Setup

The cluster uses a hub-spoke model with Tailscale for secure inter-machine communication.

```
                    ┌────────────────────┐
                    │   VPS (Gateway)    │
                    │  100.102.127.45    │
                    └────────┬───────────┘
                             │ Tailscale mesh
            ┌────────────────┼────────────────┐
            │                │                │
    ┌───────┴──────┐  ┌─────┴───────┐  ┌─────┴──────┐
    │   Mini 1-3   │  │  Mac Studio │  │  Monitoring │
    │   (workers)  │  │  (critical) │  │   (VPS)     │
    └──────────────┘  └─────────────┘  └─────────────┘
```

Each machine gets a stable Tailscale IP. The gateway on the VPS communicates with
all agents over the Tailscale network.

```bash
# On each machine:
tailscale up --authkey "$TAILSCALE_AUTH_KEY"

# Verify mesh connectivity:
tailscale status
tailscale ping <other-machine-ip>
```

### Agent Hierarchy Configuration

The fork uses a 3-level hierarchy: admin (0), lead (1), worker (2). Each level
has different permissions defined in `src/config/types.agent-hierarchy.ts`.

| Level | Permissions |
|---|---|
| **0 (admin)** | SSH: all machines, Credentials: full, Gateway restart: yes, Spawn sub-agents: yes, Send to: all agents |
| **1 (lead)** | SSH: own machine, Credentials: read, Gateway restart: no, Spawn sub-agents: yes, Send to: team + leads |
| **2 (worker)** | SSH: none, Credentials: none, Gateway restart: no, Spawn sub-agents: no, Send to: lead only |

Example configuration for all 28 agents:

```jsonc
{
  "agentHierarchy": {
    // === Level 0: Admins ===
    "jarvis": {
      "level": 0,
      "permissions": {
        "ssh": "all",
        "credentials": "all",
        "gateway_restart": true,
        "spawn_subagents": true,
        "send_to_agents": "all"
      },
      "workers": ["vs-assistant", "trinity"]
    },
    "rex": {
      "level": 0,
      "permissions": {
        "ssh": "all",
        "credentials": "all",
        "gateway_restart": true,
        "spawn_subagents": true,
        "send_to_agents": "all"
      },
      "workers": ["bolito", "creator"]
    },

    // === Level 1: Leads ===
    "vs-assistant": {
      "level": 1,
      "lead": "jarvis",
      "permissions": {
        "ssh": "own_machine",
        "credentials": "read",
        "gateway_restart": false,
        "spawn_subagents": true,
        "send_to_agents": "team"
      },
      "workers": ["trinity"]
    },
    "justin": {
      "level": 1,
      "lead": "jarvis",
      "permissions": {
        "ssh": "own_machine",
        "credentials": "read",
        "gateway_restart": false,
        "spawn_subagents": true,
        "send_to_agents": "team"
      },
      "workers": ["stark", "boris"]
    },
    "bob": {
      "level": 1,
      "lead": "rex",
      "permissions": {
        "ssh": "own_machine",
        "credentials": "read",
        "gateway_restart": false,
        "spawn_subagents": true,
        "send_to_agents": "team"
      },
      "workers": ["maximus"]
    },
    "bolito": {
      "level": 1,
      "lead": "rex",
      "permissions": {
        "ssh": "own_machine",
        "credentials": "read",
        "gateway_restart": false,
        "spawn_subagents": true,
        "send_to_agents": "team"
      },
      "workers": ["creator"]
    },

    // === Level 2: Workers ===
    "trinity": {
      "level": 2,
      "lead": "vs-assistant",
      "permissions": {
        "ssh": "none",
        "credentials": "none",
        "gateway_restart": false,
        "spawn_subagents": false,
        "send_to_agents": "lead_only"
      }
    },
    "stark": {
      "level": 2,
      "lead": "justin",
      "permissions": {
        "ssh": "none",
        "credentials": "none",
        "gateway_restart": false,
        "spawn_subagents": false,
        "send_to_agents": "lead_only"
      }
    },
    "boris": {
      "level": 2,
      "lead": "justin",
      "permissions": {
        "ssh": "none",
        "credentials": "none",
        "gateway_restart": false,
        "spawn_subagents": false,
        "send_to_agents": "lead_only"
      }
    },
    "maximus": {
      "level": 2,
      "lead": "bob",
      "permissions": {
        "ssh": "none",
        "credentials": "none",
        "gateway_restart": false,
        "spawn_subagents": false,
        "send_to_agents": "lead_only"
      }
    },
    "creator": {
      "level": 2,
      "lead": "bolito",
      "permissions": {
        "ssh": "none",
        "credentials": "none",
        "gateway_restart": false,
        "spawn_subagents": false,
        "send_to_agents": "lead_only"
      }
    }
    // ... remaining workers follow the same Level 2 pattern
  }
}
```

### SmartRouter Configuration

The SmartRouter (`src/routing/smart-router.ts`) prioritizes free Claude Code
instances over paid API calls. It manages rate limit detection with a 5-hour
sliding window reset.

```jsonc
{
  "smartRouter": {
    "enabled": true,
    "claudeCode": {
      "instances": [
        {
          "host": "mini-1",
          "user": "user1",
          "subscription": "claude-max-1",
          "rateLimited": false
        },
        {
          "host": "mini-2",
          "user": "user2",
          "subscription": "claude-max-2",
          "rateLimited": false
        },
        {
          "host": "mac-studio",
          "user": "user3",
          "subscription": "claude-max-3",
          "rateLimited": false
        }
      ],
      "onRateLimit": "api",
      "queueRetryMinutes": 15
    },
    "queueDir": "/var/openclaw/queue"
  }
}
```

**Routing priority:**

1. Free Claude Code instances are tried first (cost: $0)
2. If all instances are rate-limited, falls back to paid API
3. Rate limit reset: 5-hour sliding window (~200-300 Opus messages/day per Max subscription)

---

## VPS-Only Deployment

Simplified deployment for a single VPS running the gateway and all agents.

```bash
# 1. Provision a VPS (Debian/Ubuntu recommended, 4GB+ RAM)
ssh root@your-vps-ip

# 2. Install Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git

# 3. Enable corepack for pnpm
corepack enable

# 4. Clone and setup
git clone https://github.com/openclaw/openclaw.git /root/openclaw-fork
cd /root/openclaw-fork
git checkout feature/security-phase0
pnpm install

# 5. Run tests
npx vitest run src/security/ src/billing/ src/health/

# 6. Build
pnpm build

# 7. Configure environment
cat >> ~/.profile << 'ENVEOF'
export OPENCLAW_DATA_DIR="/var/openclaw/data"
export OPENCLAW_AUDIT_DIR="/var/openclaw/audit"
export OPENCLAW_BILLING_DIR="/var/openclaw/billing"
export OPENCLAW_MASTER_PASSWORD="<your-strong-password>"
ENVEOF
source ~/.profile

# 8. Create data directories
mkdir -p "$OPENCLAW_DATA_DIR" "$OPENCLAW_AUDIT_DIR" "$OPENCLAW_BILLING_DIR"

# 9. Create systemd service
cat > /etc/systemd/system/openclaw-gateway.service << 'EOF'
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/openclaw-fork
ExecStart=/usr/bin/node openclaw.mjs gateway run --bind loopback --port 18789 --force
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=-/root/.openclaw/env

[Install]
WantedBy=multi-user.target
EOF

# 10. Start
systemctl daemon-reload
systemctl enable openclaw-gateway
systemctl start openclaw-gateway

# 11. Verify
systemctl status openclaw-gateway
ss -ltnp | grep 18789
journalctl -u openclaw-gateway -n 50
```

---

## Docker Deployment

### Dockerfile (using the repo's existing multi-stage build)

The repository includes a production Dockerfile at the repo root. Build with fork
modules included:

```bash
# Build the Docker image
docker build -t openclaw-fork:latest .

# Run with environment variables
docker run -d \
  --name openclaw-gateway \
  --restart unless-stopped \
  -p 18789:18789 \
  -e OPENCLAW_DATA_DIR=/data \
  -e OPENCLAW_AUDIT_DIR=/data/audit \
  -e OPENCLAW_BILLING_DIR=/data/billing \
  -e OPENCLAW_MASTER_PASSWORD="<your-strong-password>" \
  -e NODE_ENV=production \
  -v openclaw-data:/data \
  openclaw-fork:latest \
  node openclaw.mjs gateway run --bind lan --port 18789 --force
```

> **IMPORTANT:** The default Dockerfile CMD binds to loopback (127.0.0.1). With
> Docker bridge networking (`-p 18789:18789`), you must either use `--network host`
> or override `--bind` to `lan` (0.0.0.0) and configure authentication credentials.

### docker-compose.yml

```yaml
version: "3.8"

services:
  gateway:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: openclaw-gateway
    restart: unless-stopped
    ports:
      - "18789:18789"
    environment:
      - NODE_ENV=production
      - OPENCLAW_DATA_DIR=/data
      - OPENCLAW_AUDIT_DIR=/data/audit
      - OPENCLAW_BILLING_DIR=/data/billing
      - OPENCLAW_MASTER_PASSWORD=${OPENCLAW_MASTER_PASSWORD}
      - CLAUDE_MAX_SUBSCRIPTION_1=${CLAUDE_MAX_SUBSCRIPTION_1:-}
      - CLAUDE_MAX_SUBSCRIPTION_2=${CLAUDE_MAX_SUBSCRIPTION_2:-}
      - CLAUDE_MAX_SUBSCRIPTION_3=${CLAUDE_MAX_SUBSCRIPTION_3:-}
    volumes:
      - openclaw-data:/data
    command: ["node", "openclaw.mjs", "gateway", "run", "--bind", "lan", "--port", "18789", "--force"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 3m
      timeout: 10s
      start_period: 15s
      retries: 3

volumes:
  openclaw-data:
    driver: local
```

Start with:

```bash
# Create .env file with secrets (DO NOT commit this file)
cat > .env << 'EOF'
OPENCLAW_MASTER_PASSWORD=<your-strong-password>
CLAUDE_MAX_SUBSCRIPTION_1=user1@host1
CLAUDE_MAX_SUBSCRIPTION_2=user2@host2
CLAUDE_MAX_SUBSCRIPTION_3=user3@host3
EOF

docker compose up -d
docker compose logs -f gateway
```

---

## Environment Variables

### Core Configuration

| Variable | Description | Required | Default |
|---|---|---|---|
| `OPENCLAW_DATA_DIR` | Root data directory for all persisted state | Yes | `~/.openclaw/data` |
| `OPENCLAW_AUDIT_DIR` | Audit log JSONL directory (hash chain) | Yes | `~/.openclaw/audit` |
| `OPENCLAW_BILLING_DIR` | Cost tracking JSONL directory | Yes | `~/.openclaw/billing` |
| `OPENCLAW_MASTER_PASSWORD` | Master password for SecretsStore AES-256-GCM encryption | Yes | None |
| `NODE_ENV` | Runtime environment (`production`, `development`) | No | `development` |

### SmartRouter

| Variable | Description | Required |
|---|---|---|
| `CLAUDE_MAX_SUBSCRIPTION_1` | First Claude Max instance (`user@host`) | Yes (if SmartRouter enabled) |
| `CLAUDE_MAX_SUBSCRIPTION_2` | Second Claude Max instance (`user@host`) | Yes (if SmartRouter enabled) |
| `CLAUDE_MAX_SUBSCRIPTION_3` | Third Claude Max instance (`user@host`) | Yes (if SmartRouter enabled) |

### Networking

| Variable | Description | Required |
|---|---|---|
| `TAILSCALE_AUTH_KEY` | Tailscale auth key for mesh network setup | Multi-machine only |

### Agent-Specific Credentials

These are managed through the CredentialVault (`src/security/credential-vault.ts`)
with per-agent access control. Store them via the vault, not as plain environment variables.

| Variable | Description | Access Level |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (API fallback) | Level 0 (admin) |
| `OPENAI_API_KEY` | OpenAI API key | Level 0 (admin) |
| `TELEGRAM_BOT_TOKEN_*` | Per-agent Telegram bot tokens | Level 1+ (per-agent allowlist) |
| `DISCORD_BOT_TOKEN` | Discord bot token (raw, no prefix) | Level 0 (admin) |
| `GITHUB_TOKEN` | GitHub API token | Level 0 (admin) |

### Budget Limits

| Variable | Description | Default |
|---|---|---|
| `OPENCLAW_DAILY_BUDGET_USD` | Daily cost budget in USD (0 = unlimited) | `0` |
| `OPENCLAW_MONTHLY_BUDGET_USD` | Monthly cost budget in USD | `0` |
| `OPENCLAW_BUDGET_MODEL_DOWNGRADE` | Model to downgrade to when budget exceeded | `claude-haiku-3-5` |
| `OPENCLAW_BUDGET_BLOCK_ON_EXCEED` | Block requests when budget exceeded (vs downgrade) | `false` |

> **SECURITY WARNING:** The `OPENCLAW_MASTER_PASSWORD` protects all encrypted secrets
> in the SecretsStore. It is derived via PBKDF2 (100,000 iterations) into an AES-256
> encryption key. If lost, all stored secrets become permanently inaccessible. Back it
> up securely outside the deployment.

---

## Health Checks

### Verifying Deployment

```bash
# Check gateway status and probe all channels
openclaw channels status --probe

# Check port binding
ss -ltnp | grep 18789

# Check recent logs
tail -n 120 /tmp/openclaw-gateway.log

# Run the full security test suite (86+ tests)
npx vitest run src/security/

# Run penetration tests
npx vitest run src/security/penetration-tests.test.ts

# Run billing and health module tests
npx vitest run src/billing/ src/health/

# Verify audit chain integrity (programmatic)
# In a Node.js script or REPL:
# import { AuditLogger } from "./src/security/audit-logger.js";
# const logger = new AuditLogger({ logDir: process.env.OPENCLAW_AUDIT_DIR });
# const result = logger.verifyChain();
# console.log(result);
# // { valid: true, totalRecords: 1234 }
```

### Docker Health Checks

The Docker image includes built-in health check endpoints:

```bash
# Liveness probe
curl -f http://127.0.0.1:18789/healthz

# Readiness probe
curl -f http://127.0.0.1:18789/readyz

# Docker health status
docker inspect --format='{{.State.Health.Status}}' openclaw-gateway
```

### AutoHealer Monitoring

The AutoHealer (`src/health/auto-healer.ts`) handles 8 issue types automatically:

| Issue Type | Action | Severity |
|---|---|---|
| `gateway_down` | Restart gateway with correct PATH | Critical |
| `auth_error` | Validate and rollback auth profile | High |
| `backup_stale` | Retry backup with error logging | Medium |
| `agent_frozen` | Kill frozen session and restart | High |
| `bot_token_invalid` | Validate token (escalates to admin) | High |
| `version_outdated` | Notify admin (no auto-update) | Low |
| `telegram_bot_error` | Check bot connectivity via getMe API | Medium |
| `ssh_unreachable` | Network health check (escalates) | Critical |

**Configuration defaults:**

- `maxAttemptsPerHour`: 3 (per issue type per machine)
- `cooldownSeconds`: 300 (5 minutes between attempts)
- `remotePath`: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`

When max attempts are exceeded, the issue is escalated to the admin via the
configured escalation callback (e.g., Telegram notification).

---

## Sync with Upstream

The fork tracks `openclaw/openclaw` upstream. Weekly sync is recommended
(e.g., Monday 09:00 via cron).

### Manual sync

```bash
# Dry run first (shows new commits and potential conflicts)
./scripts/sync-upstream.sh --dry-run

# Full sync with auto-resolve (keeps our version for protected paths)
./scripts/sync-upstream.sh --auto-resolve
```

### Cron schedule

```bash
# Add to crontab (crontab -e)
0 9 * * 1 cd /root/openclaw-fork && ./scripts/sync-upstream.sh --auto-resolve >> /var/log/openclaw-sync.log 2>&1
```

### Protected paths (always keep ours during auto-resolve)

The following paths are fork-specific and always kept during merge conflicts:

- `src/security/` -- All security modules (audit logger, secrets store, injection shield, etc.)
- `src/billing/` -- Cost tracker and cost models
- `src/health/` -- AutoHealer
- `src/agents/agent-permissions.*` -- Agent hierarchy permissions
- `src/routing/smart-router.*` -- SmartRouter for Claude Max routing
- `src/config/types.agent-hierarchy.*` -- Hierarchy type definitions

### Post-sync verification

After every sync, the script automatically runs:

```bash
npx vitest run src/security/ src/billing/ src/health/ src/agents/agent-permissions.test.ts src/routing/smart-router.test.ts
```

If any test fails, the sync is aborted and requires manual investigation.

---

## Rollback Plan

If the fork breaks production, follow these steps:

### Immediate rollback to upstream

```bash
# 1. Stop the gateway
pkill -9 -f openclaw-gateway || true

# 2. Switch to upstream main
git checkout upstream/main
pnpm install
pnpm build

# 3. Restart gateway on upstream code
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &

# 4. Verify
openclaw channels status --probe
```

### Investigate the issue

```bash
# Check recent commits
git log --oneline -20

# Diff fork vs upstream
git diff upstream/main feature/security-phase0

# Check which fork files changed recently
git log --oneline --name-only feature/security-phase0 ^upstream/main | head -50
```

### Fix and redeploy

```bash
# 1. Switch back to fork
git checkout feature/security-phase0

# 2. Fix the issue
# ... make fixes ...

# 3. Run tests
npx vitest run src/security/ src/billing/ src/health/

# 4. Build
pnpm build

# 5. Push (use --force-with-lease for safety)
git push --force-with-lease origin feature/security-phase0

# 6. Restart gateway
pkill -9 -f openclaw-gateway || true
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
```

> **WARNING:** `git push --force-with-lease` will reject if the remote has commits
> you have not fetched. This is a safety mechanism. Only use `--force` if you are
> certain no other contributors have pushed to the branch.

### For systemd deployments (VPS)

```bash
# Rollback
git checkout upstream/main
pnpm install && pnpm build
systemctl restart openclaw-gateway
systemctl status openclaw-gateway

# Check logs
journalctl -u openclaw-gateway -n 100 --no-pager
```

---

## Monitoring and Alerts

### Cost Tracking

The CostTracker (`src/billing/cost-tracker.ts`) writes usage records as JSONL files,
one per day (`usage-YYYY-MM-DD.jsonl`).

```bash
# View today's cost data
cat "$OPENCLAW_BILLING_DIR/usage-$(date +%Y-%m-%d).jsonl" | jq .

# Sum total daily cost
cat "$OPENCLAW_BILLING_DIR/usage-$(date +%Y-%m-%d).jsonl" | jq -s '[.[].cost] | add'

# Cost breakdown by agent
cat "$OPENCLAW_BILLING_DIR/usage-$(date +%Y-%m-%d).jsonl" | jq -s 'group_by(.agentId) | map({agent: .[0].agentId, cost: [.[].cost] | add})'
```

Supported models and pricing (per 1M tokens):

| Model | Input | Output | Cached Input |
|---|---|---|---|
| claude-opus-4-6 | $15.00 | $75.00 | $1.50 |
| claude-sonnet-4-5 | $3.00 | $15.00 | $0.30 |
| claude-haiku-3-5 | $0.80 | $4.00 | $0.08 |
| gpt-4.1 | $2.00 | $8.00 | $0.50 |
| o3 | $10.00 | $40.00 | -- |
| gemini-2.5-pro | $1.25 | $10.00 | -- |

Budget enforcement: when an agent exceeds its daily budget, the CostTracker can either
block the request or auto-downgrade to a cheaper model (e.g., `claude-haiku-3-5`).

### Audit Logs

The AuditLogger (`src/security/audit-logger.ts`) writes tamper-evident JSONL files
with SHA-256 hash chain verification. Each record links to the previous via `prevHash`.

```bash
# View today's audit log
cat "$OPENCLAW_AUDIT_DIR/audit-$(date +%Y-%m-%d).jsonl" | jq .

# Count events by type
cat "$OPENCLAW_AUDIT_DIR/audit-$(date +%Y-%m-%d).jsonl" | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'

# Find security events
cat "$OPENCLAW_AUDIT_DIR/audit-$(date +%Y-%m-%d).jsonl" | jq 'select(.type | startswith("security."))'
```

Tracked event types include: `tool.exec`, `tool.read`, `tool.write`, `tool.web_fetch`,
`message.send`, `message.receive`, `auth.login`, `auth.failure`, `policy.deny`,
`policy.warn`, `session.create`, `session.destroy`, `config.change`, `skill.install`,
`security.injection_detected`, `security.exfil_blocked`, `security.backdoor_found`.

Secret scrubbing is enabled by default: API keys, tokens, private keys, and passwords
are automatically redacted before writing to the audit log.

### Anomaly Detection

The AnomalyDetector (`src/security/anomaly-detector.ts`) builds behavioral baselines
per agent and alerts on deviations:

| Anomaly Type | Description | Default Severity |
|---|---|---|
| `exec_frequency` | Execution rate exceeds baseline multiplier | Variable (0-1) |
| `new_tool` | Agent using a previously unseen tool | 0.6 |
| `off_hours` | Activity outside established typical hours | Configurable |
| `data_volume` | Data transfer exceeds baseline multiplier | Variable (0-1) |
| `failed_auth` | Multiple failed auth attempts in 5 minutes | 0.9 |
| `suspicious_path` | Access to sensitive paths (`/etc/passwd`, `.ssh/`, `.env`, etc.) | 0.95 |

The detector operates in learning mode during baseline establishment (minimum 10
activities over the configured baseline window). Alerts are suppressed during learning.

### Budget Enforcement

When daily cost exceeds the configured budget:

1. **Auto-downgrade mode:** Requests continue but are routed to a cheaper model
2. **Block mode:** Requests are denied until the next day
3. Admin receives a notification via the escalation callback

```bash
# Check current daily spend across all agents
cat "$OPENCLAW_BILLING_DIR/usage-$(date +%Y-%m-%d).jsonl" | jq -s '[.[].cost] | add // 0'
```

---

## Appendix: Fork Module Test Coverage

Run the complete fork test suite to verify all modules:

```bash
# All fork modules
npx vitest run \
  src/security/ \
  src/billing/ \
  src/health/ \
  src/agents/agent-permissions.test.ts \
  src/routing/smart-router.test.ts

# Security-only (86+ tests including penetration tests)
npx vitest run src/security/

# Full upstream + fork test suite
pnpm test
```

For coverage reports:

```bash
pnpm test:coverage
```

Target: 70% lines/branches/functions/statements (enforced by Vitest V8 thresholds).
