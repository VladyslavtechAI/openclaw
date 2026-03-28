# OpenClaw Fork — Version Tracking

## Current Version: 1.0.0
**Base:** openclaw/openclaw @ main (Mar 27, 2026)  
**Fork:** VladyslavtechAI/openclaw

## Release History

### v1.0.0 — Security & Infrastructure Foundation (Mar 27, 2026)
**Base upstream commit:** TBD (fetch on first sync)

#### Modules Added (488 tests total)

**Phase 0 — Attack Defense (116 tests)**
- ✅ S0: InjectionShield — 3-layer prompt injection defense (pattern/structural/context)
- ✅ S9: NetworkPolicy — SSRF protection, port hardening, URL whitelist/blacklist
- ✅ S10: BackdoorScanner — file integrity monitoring, backdoor pattern detection
- ✅ S11: ExfilGuard — data exfiltration prevention (exec/message/URL analysis)
- ✅ S1: FilesystemPolicy — hidden paths, traversal protection, workspace isolation
- ✅ Audit Logger — hash-chain tamper detection, secret scrubbing, JSONL
- ✅ SubagentScope — permission downscoping, no-escalation validation
- ✅ DlpEngine — credential/PII/financial data leak prevention

**Phase 1 — Infrastructure (372 tests)**
- ✅ Agent Hierarchy — 3-tier permissions (admin/lead/worker), SSH/credentials/gateway access control
- ✅ Cost Tracking — JSONL usage tracking, budget enforcement with auto-downgrade
- ✅ Auto-Healer — 8 issue types from 37,668 real errors, cooldown, escalation
- ✅ Smart Router — Claude Code load balancing with rate limit awareness
- ✅ Credential Isolation — per-agent credential access by hierarchy level

#### Expected Impact
- **Cost savings:** ~$8,900/mo (smart router + budget enforcement)
- **Security:** Blocks prompt injection, SSRF, data exfiltration, backdoor files
- **Reliability:** Auto-fix 37K errors/mo, prevents runaway spending
- **Compliance:** Tamper-evident audit logs, DLP for GDPR/SOC 2

#### Files Changed
- `src/security/` — 10 new modules, 116 tests
- `src/agents/` — agent-permissions.ts + tests
- `src/billing/` — cost-tracker.ts, cost-models.ts + tests
- `src/health/` — auto-healer.ts + tests
- `src/routing/` — smart-router.ts + tests
- `src/config/` — agent hierarchy types + zod schemas

---

## Sync Strategy

### Upstream Tracking
- **Upstream remote:** https://github.com/openclaw/openclaw.git
- **Sync frequency:** Weekly (Monday 09:00 via cron)
- **Sync script:** `scripts/sync-upstream.sh`

### Merge Rules
1. **Always keep OUR version for:**
   - `src/security/` (all our modules)
   - `src/billing/` (cost tracking)
   - `src/health/` (auto-healer)
   - `src/agents/agent-permissions.*`
   - `src/routing/smart-router.*`

2. **Merge upstream changes for:**
   - Core OpenClaw runtime (`src/runtime/`, `src/server/`)
   - Tool implementations (`src/tools/`)
   - Gateway (`src/gateway/`)
   - Channels (`src/channels/`)
   - Docs (`docs/`)

3. **Manual review required for:**
   - `src/config/` (if upstream changes config schema)
   - `package.json` (if upstream adds dependencies)
   - `tsconfig.json` (if upstream changes TypeScript config)

### Conflict Resolution
- **Auto-resolve:** `./scripts/sync-upstream.sh --auto-resolve` (keeps OUR version for protected paths)
- **Dry run:** `./scripts/sync-upstream.sh --dry-run` (preview changes without merging)
- **Manual:** If conflicts in unprotected paths, abort and notify Jarvis

### Version Bumping
- **Patch (1.0.x):** Upstream sync with no conflicts
- **Minor (1.x.0):** New module added to fork
- **Major (x.0.0):** Breaking changes to our modules or upstream API

---

## Testing Before Deploy

Before deploying to any machine:

```bash
# 1. Run full test suite
npx vitest run src/security/ src/billing/ src/health/ src/agents/ src/routing/

# 2. Check for regressions
npm run build

# 3. Verify on VPS first (lowest risk)
ssh root@100.102.127.45
cd /root/openclaw-fork
git pull origin main
npm install
npx vitest run src/security/ src/billing/ src/health/
systemctl restart openclaw-gateway

# 4. If VPS OK → deploy to Mini machines
```

---

## Deployment Checklist

- [ ] Tests pass (488/488)
- [ ] Build succeeds
- [ ] VPS deployed + verified
- [ ] Mini 1 deployed (Jarvis, VS Assistant, Trinity)
- [ ] Mini 2 deployed (Justin, Stark, Boris, etc.)
- [ ] Mini 3 deployed (Bob, Maximus)
- [ ] Mac Studio deployed (Rex, Bolito, Creator)
- [ ] All agents report no errors for 24h

---

## Rollback Plan

If fork breaks production:

```bash
# 1. Revert to upstream main
git checkout upstream/main
npm install
npm run build
systemctl restart openclaw-gateway

# 2. Investigate failure
git log --oneline -20
git diff upstream/main feature/security-phase0

# 3. Fix + redeploy fork
git checkout feature/security-phase0
# fix issue
git commit --amend
git push --force-with-lease
```

---

## Future Modules (Roadmap)

### Phase 2 — Compliance & Monitoring (planned)
- S6: Content Safety — toxic/harmful content detection, configurable policies
- S7: Data Retention — automated deletion, configurable retention periods
- S8: Anomaly Detection — ML-based behavior analysis, alert on deviation

### Phase 3 — Enterprise Features (planned)
- Multi-tenant isolation
- SSO integration (SAML/OIDC)
- Webhook audit delivery for SIEM
- Prometheus metrics export
