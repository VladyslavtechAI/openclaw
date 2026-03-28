# Business Solutions

This fork provides three enterprise solutions for different organizational structures. Each solution is independent and can be deployed standalone or combined.

## Solution 1 — Retail Isolated (Multi-Tenant SaaS)

### Overview
A multi-tenant system where each retail client gets fully isolated agents, data, and billing. Designed for SaaS providers offering AI agent services to multiple independent clients.

**Directory:** `src/tenancy/`
**Modules:** TenantManager, TenantIsolation, TenantBilling, AgentTemplateRegistry, TenantDashboard

### Use Cases
- AI agency selling agent services to retail businesses
- Each client gets isolated workspace, credentials, network policies
- Per-tenant billing with budget caps and auto-downgrade
- Pre-built agent templates for common retail scenarios

### Architecture
- TenantManager: CRUD operations, suspension/resume, generates per-tenant directory structure (workspace/, logs/, credentials/, billing/)
- TenantIsolation: Composes FilesystemPolicy + NetworkPolicy + CredentialVault per tenant. Full sandboxing
- TenantBilling: Wraps CostTracker with daily/monthly budget caps. Auto-downgrade to claude-haiku-3-5 when over daily limit. Block when over monthly limit
- AgentTemplateRegistry: 6 built-in templates (customer-service, inventory-assistant, scheduling-coordinator, reporting-analyst, product-recommender, returns-processor)
- TenantDashboard: Real-time metrics, health assessment, budget forecasting, agent comparison

### Setup Guide

```typescript
import { TenantManager } from "./tenancy/tenant-manager.js";
import { TenantIsolation } from "./tenancy/tenant-isolation.js";
import { TenantBilling } from "./tenancy/tenant-billing.js";
import { AgentTemplateRegistry } from "./tenancy/agent-templates.js";
import { TenantDashboard } from "./tenancy/tenant-dashboard.js";

// 1. Create tenant
const manager = new TenantManager({ dataDir: "/data/tenants" });
const tenant = manager.createTenant("Acme Retail", "professional");

// 2. Setup isolation
const isolation = new TenantIsolation(tenant);
const sandbox = isolation.createSandboxEnv("agent-1", 2); // worker level

// 3. Configure billing
const billing = new TenantBilling(tenant.id, {
  dailyBudget: 50,    // $50/day
  monthlyBudget: 1000  // $1000/month
});

// 4. Deploy from template
const templates = new AgentTemplateRegistry();
const config = templates.generateAgentConfig(
  templates.getTemplate("customer-service")!,
  tenant.id
);

// 5. Monitor
const dashboard = new TenantDashboard(tenant.id, { billing });
const health = dashboard.assessHealth();
const forecast = dashboard.getBudgetForecast();
```

### Agent Templates

| Template | Category | Default Model | Tools |
|----------|----------|---------------|-------|
| customer-service | customer-service | claude-sonnet-4-5 | web_search, knowledge_base, ticket_create |
| inventory-assistant | operations | claude-haiku-3-5 | database_query, spreadsheet, alert |
| scheduling-coordinator | operations | claude-sonnet-4-5 | calendar, email, notification |
| reporting-analyst | analytics | claude-sonnet-4-5 | database_query, chart, export |
| product-recommender | sales | claude-sonnet-4-5 | product_search, user_profile, recommendation |
| returns-processor | operations | claude-haiku-3-5 | order_lookup, refund, email |

### Billing Workflow
1. Each API request → TenantBilling.trackRequest() → writes to JSONL
2. Before each request → checkBudget()
3. If daily budget exceeded → auto-downgrade to claude-haiku-3-5
4. If monthly budget exceeded → block requests (shouldBlock: true)
5. Dashboard shows real-time spend, forecasting, agent comparison

### Tenant Lifecycle
- created → active → suspended (non-payment) → resumed OR → deleted (soft) → hardDeleted (permanent)

---

## Solution 2 — Corporate Pyramidal (Hierarchical Organization)

### Overview
A hierarchical system matching corporate org charts. Supports up to 10 levels of management, approval workflows, department isolation, SSO integration, and compliance reporting.

**Directory:** `src/corporate/`
**Modules:** HierarchyManager, ApprovalWorkflow, DepartmentIsolation, ReportingPipeline, SSOBridge, ComplianceExporter

### Use Cases
- Large corporation deploying AI agents matching their org structure
- CEO → VPs → Directors → Managers → Workers
- Multi-department isolation with controlled cross-department access
- SAML/OIDC SSO integration
- SOC 2, HIPAA, GDPR compliance evidence generation

### Architecture
- HierarchyManager: Tree structure up to 10 levels. Capability delegation (parent can delegate to child in reporting chain). Common ancestor finding for cross-branch operations
- ApprovalWorkflow: Multi-level approval chains. Default 24h timeout with auto-escalation. Full audit trail per request
- DepartmentIsolation: Data boundaries per department. Shared-read zones for cross-department visibility. Formal request/approval protocol for cross-department access
- ReportingPipeline: JSONL metrics recording. Automated rollup by department. Markdown and JSON report generation. Configurable schedules (daily/weekly/monthly)
- SSOBridge: SAML assertion validation (issuer, time conditions). OIDC token validation (issuer, audience, expiry). Role-to-hierarchy-level mapping. Session management with expiry cleanup
- ComplianceExporter: SOC 2 Type II, HIPAA, GDPR, ISO 27001, PCI-DSS. Evidence package generation. Custom control registration. Audit log export

### Setup Guide

```typescript
import { HierarchyManager } from "./corporate/hierarchy-manager.js";
import { ApprovalWorkflow } from "./corporate/approval-workflow.js";
import { DepartmentIsolation } from "./corporate/department-isolation.js";
import { SSOBridge } from "./corporate/sso-bridge.js";
import { ComplianceExporter } from "./corporate/compliance-exporter.js";

// 1. Build org chart
const hierarchy = new HierarchyManager({ maxDepth: 10 });
const ceo = hierarchy.addAgent("ceo-agent", "CEO", "executive");
const vpEng = hierarchy.addAgent("vp-eng", "VP Engineering", "engineering", "ceo-agent");
const dirBackend = hierarchy.addAgent("dir-backend", "Director Backend", "engineering", "vp-eng");
const devLead = hierarchy.addAgent("dev-lead", "Dev Lead", "engineering", "dir-backend");
const dev1 = hierarchy.addAgent("dev-1", "Developer", "engineering", "dev-lead");

// 2. Delegate capabilities
hierarchy.delegateCapability("vp-eng", "dir-backend", "deploy_staging");
hierarchy.delegateCapability("dir-backend", "dev-lead", "code_review");

// 3. Setup departments
const deptIsolation = new DepartmentIsolation();
deptIsolation.createDepartment("engineering", "Engineering", "vp-eng");
deptIsolation.createDepartment("finance", "Finance", "vp-finance");

// 4. Configure SSO
const sso = new SSOBridge({
  oidcConfig: { clientId: "openclaw-corp", issuer: "https://auth.company.com", audience: "openclaw" },
  roleMapping: { "admin": 0, "manager": 1, "employee": 2 }
});

// 5. Setup compliance
const compliance = new ComplianceExporter();
const evidence = compliance.generateEvidencePackage("soc2", {
  from: Date.now() - 90 * 86400000,
  to: Date.now()
});
```

### Approval Workflow
1. Agent creates request → ApprovalWorkflow.createRequest(requesterId, type, description, approvers)
2. First approver reviews → approve() or deny()
3. If no action within timeout (24h) → auto-escalate to next approver
4. Full audit trail: created → approved/denied/escalated/expired
5. processTimeouts() should be called periodically (cron/timer)

### SSO Role Mapping
```typescript
// Map IdP roles to hierarchy levels
roleMapping: {
  "super_admin": 0,  // admin (SSH, credentials, gateway)
  "team_lead": 1,    // lead (credentials read, subagents)
  "developer": 2,    // worker (basic tools only)
}
```

---

## Solution 3 — Group of Companies (Holding Structure)

### Overview
A holding company structure where multiple independent companies share infrastructure while maintaining data isolation. Supports cross-company services, approval-gated communication, consolidated billing, and version management.

**Directory:** `src/group/`
**Modules:** GroupManager, CompanyEnvironment, SharedServiceRegistry, CrossCompanyBus, ConsolidatedBilling, VersionManager

### Use Cases
- Holding company with multiple subsidiaries
- Each company gets isolated runtime, agents, data
- Shared services (agents, models, tools) across companies with usage attribution
- Cross-company communication requiring approval
- Consolidated billing with inter-company cost allocation
- Staged version rollouts across companies

### Architecture
- GroupManager: Company CRUD with confirmation-required delete. Cross-company access policies with glob pattern matching. Group-level statistics
- CompanyEnvironment: Isolated workspace per company. Agent pool management. Data sovereignty enforcement (canDataLeaveRegion). Endpoint allowlisting. Disk usage tracking
- SharedServiceRegistry: Register agents/models/tools as shared services. Per-service concurrency limits. Company-level access grants. Usage tracking with cost attribution
- CrossCompanyBus: Approval-gated message routing. Thread-based conversations. Per-company audit trail. Statistics tracking (sent/received/pending/rejected)
- ConsolidatedBilling: Per-company budgets. Cost recording and budget status. Inter-company cost allocation. Group-level invoicing
- VersionManager: Per-company version pinning. Multi-stage rollouts (e.g., canary → 10% → 50% → 100%). Canary deployments with metrics tracking (requests, errors, latency P50/P99). Pass/fail canary decisions

### Setup Guide

```typescript
import { GroupManager } from "./group/group-manager.js";
import { CompanyEnvironment } from "./group/company-environment.js";
import { SharedServiceRegistry } from "./group/shared-service-registry.js";
import { CrossCompanyBus } from "./group/cross-company-bus.js";
import { ConsolidatedBilling } from "./group/consolidated-billing.js";
import { VersionManager } from "./group/version-manager.js";

// 1. Create companies
const group = new GroupManager({ dataDir: "/data/group" });
const companyA = group.createCompany("TechCorp", {
  maxAgents: 20, allowedModels: ["claude-sonnet-4-5", "claude-haiku-3-5"], dataRegion: "us-east"
});
const companyB = group.createCompany("FinanceCorp", {
  maxAgents: 10, allowedModels: ["claude-sonnet-4-5"], dataRegion: "eu-west"
});

// 2. Setup cross-company policies
group.createPolicy({
  name: "TechCorp reads FinanceCorp reports",
  sourceCompany: companyA.id,
  targetCompany: companyB.id,
  accessType: "read",
  resourcePattern: "reports/*"
});

// 3. Isolated environments
const envA = new CompanyEnvironment(companyA.id, companyA.config, "/data/companies");
envA.activateAgent("tech-agent-1");

// 4. Share services
const registry = new SharedServiceRegistry();
const service = registry.registerService({
  name: "Shared Analytics Agent",
  ownerCompany: companyA.id,
  type: "agent",
  maxConcurrency: 5,
  authorizedCompanies: [companyA.id, companyB.id]
});

// 5. Cross-company messaging
const bus = new CrossCompanyBus({ requireApproval: true });
const msg = bus.sendMessage(companyA.id, companyB.id, "request", { query: "Q3 report" });
bus.approveMessage(msg.id, "finance-admin");

// 6. Consolidated billing
const billing = new ConsolidatedBilling();
billing.setCompanyBudget(companyA.id, 5000);
billing.setCompanyBudget(companyB.id, 3000);
billing.recordCost(companyA.id, "Claude Sonnet usage", 150);
billing.allocateCost(companyA.id, companyB.id, 50, "Shared analytics usage");

// 7. Version management
const versions = new VersionManager();
const rollout = versions.createRollout("2.0.0", [
  { name: "canary", companies: [companyA.id] },
  { name: "production", companies: [companyB.id] }
]);
versions.startRollout(rollout.id);
```

### Cross-Company Communication Flow
1. Company A sends message → CrossCompanyBus.sendMessage() → status: pending_approval
2. Company B admin reviews → approveMessage() or rejectMessage()
3. If approved → Company B receives → markDelivered()
4. Response via sendResponse() auto-links to thread
5. Full audit trail per company via getCompanyAuditTrail()

### Version Rollout Strategy
1. Pin current version for all companies
2. Create staged rollout: canary → pilot → production
3. Deploy canary with metrics tracking
4. If canary passes (low errors, acceptable latency) → advance to next stage
5. If canary fails → stop rollout, keep companies on pinned version

### Data Sovereignty
- Each company has a dataRegion setting
- CompanyEnvironment.canDataLeaveRegion(targetRegion) enforces data stays in region
- Cross-company bus messages are logged per-company for audit

---

## Choosing a Solution

| Criteria | Solution 1 (Retail) | Solution 2 (Corporate) | Solution 3 (Group) |
|----------|---------------------|------------------------|---------------------|
| Org structure | Flat (independent tenants) | Pyramidal (org chart) | Federated (holding) |
| Isolation level | Full (filesystem + network + creds) | Department-based | Company-based |
| Billing | Per-tenant budgets | Org-wide | Consolidated + inter-company |
| SSO | Not included | SAML + OIDC | Not included |
| Compliance | Via security modules | Built-in (SOC2/HIPAA/GDPR) | Via security modules |
| Cross-entity comms | Not applicable | Cross-department requests | Approval-gated bus |
| Version management | Not included | Not included | Staged rollouts + canary |
| Agent templates | 6 built-in | Not included | Not included |
| Best for | SaaS providers | Enterprise orgs | Holding companies |

## Combining Solutions

Solutions can be combined. For example:
- **Group + Corporate**: Each company in the group uses Corporate Pyramidal internally
- **Group + Retail**: A company in the group offers Retail SaaS to its clients
- **Corporate + Security**: All solutions inherit the 17 security modules
