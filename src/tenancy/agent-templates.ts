/**
 * Agent Template Registry for pre-built retail agent templates.
 * Provides customer service, inventory, scheduling, and reporting templates.
 */

export type AgentCapability =
  | "chat"
  | "web_search"
  | "web_fetch"
  | "file_read"
  | "file_write"
  | "exec_bash"
  | "webhook_call";

export type AgentTemplate = {
  id: string;
  name: string;
  description: string;
  category: "customer_service" | "inventory" | "scheduling" | "reporting" | "custom";
  systemPrompt: string;
  capabilities: AgentCapability[];
  /** Suggested model */
  model?: string;
  /** Example tasks this agent can handle */
  examples?: string[];
  /** Required webhook integrations */
  requiredWebhooks?: string[];
  /** Default configuration */
  config?: Record<string, unknown>;
};

export type CustomizationOptions = {
  /** Override system prompt */
  systemPrompt?: string;
  /** Add/remove capabilities */
  capabilities?: {
    add?: AgentCapability[];
    remove?: AgentCapability[];
  };
  /** Override model */
  model?: string;
  /** Custom configuration */
  config?: Record<string, unknown>;
};

/**
 * Pre-built agent templates for retail businesses.
 */
export const BUILTIN_TEMPLATES: AgentTemplate[] = [
  {
    id: "customer-service",
    name: "Customer Service Agent",
    description: "Handles customer inquiries, order status, returns, and support tickets",
    category: "customer_service",
    systemPrompt: `You are a friendly customer service agent for a retail store.
Your goal is to help customers with:
- Order status inquiries
- Product information and recommendations
- Returns and refunds
- Store hours and location
- General support questions

Be professional, empathetic, and efficient. Always verify customer information before discussing orders.
If you cannot help with a request, politely escalate to a human agent.`,
    capabilities: ["chat", "web_search", "webhook_call"],
    model: "claude-sonnet-4.5",
    examples: [
      "Check order status for order #12345",
      "What's your return policy?",
      "I need help with a defective product",
      "What are your store hours?",
    ],
    requiredWebhooks: ["crm"],
    config: {
      maxConversationLength: 20,
      escalationKeywords: ["angry", "lawsuit", "complaint", "manager"],
    },
  },
  {
    id: "inventory-assistant",
    name: "Inventory Management Assistant",
    description: "Manages stock levels, reorders, and inventory tracking",
    category: "inventory",
    systemPrompt: `You are an inventory management assistant for a retail store.
Your responsibilities include:
- Monitoring stock levels
- Triggering reorder alerts when inventory is low
- Processing inventory updates from POS system
- Generating inventory reports
- Tracking product movements

Be precise with numbers and always confirm actions before making inventory changes.`,
    capabilities: ["webhook_call", "file_read", "file_write"],
    model: "claude-haiku-4.5",
    examples: [
      "Check stock level for SKU ABC-123",
      "Reorder 50 units of product XYZ",
      "Generate low-stock report",
      "Update inventory after receiving shipment",
    ],
    requiredWebhooks: ["inventory", "pos"],
    config: {
      lowStockThreshold: 10,
      reorderQuantity: 50,
    },
  },
  {
    id: "scheduling-coordinator",
    name: "Scheduling Coordinator",
    description: "Manages employee shifts, appointments, and calendar events",
    category: "scheduling",
    systemPrompt: `You are a scheduling coordinator for a retail store.
Your tasks include:
- Managing employee shift schedules
- Booking customer appointments
- Handling schedule conflicts
- Sending shift reminders
- Generating staffing reports

Always check for conflicts before confirming schedules. Be respectful of employee availability.`,
    capabilities: ["chat", "webhook_call", "file_read", "file_write"],
    model: "claude-haiku-4.5",
    examples: [
      "Schedule John for Monday 9am-5pm shift",
      "Who's working tomorrow?",
      "Book a fitting appointment for customer at 2pm",
      "Find a replacement for Sarah's shift on Friday",
    ],
    requiredWebhooks: ["crm"],
    config: {
      workingHours: { start: "09:00", end: "21:00" },
      minShiftLength: 4,
      maxShiftLength: 10,
    },
  },
  {
    id: "reporting-analyst",
    name: "Reporting & Analytics Agent",
    description: "Generates sales reports, analytics, and business insights",
    category: "reporting",
    systemPrompt: `You are a reporting and analytics agent for a retail store.
Your role is to:
- Generate daily/weekly/monthly sales reports
- Analyze customer trends
- Track KPIs (revenue, conversion rate, average order value)
- Identify top-performing products
- Provide actionable business insights

Present data clearly with summaries and highlights. Focus on trends and anomalies.`,
    capabilities: ["webhook_call", "file_read", "file_write", "web_search"],
    model: "claude-sonnet-4.5",
    examples: [
      "Generate today's sales report",
      "What are our top 5 products this month?",
      "Show conversion rate trend for last 7 days",
      "Analyze customer demographics",
    ],
    requiredWebhooks: ["pos", "crm"],
    config: {
      reportFormats: ["json", "csv", "markdown"],
      autoReportSchedule: "daily",
    },
  },
  {
    id: "product-recommender",
    name: "Product Recommendation Agent",
    description: "Provides personalized product recommendations to customers",
    category: "customer_service",
    systemPrompt: `You are a product recommendation agent for a retail store.
Your goal is to help customers discover products they'll love by:
- Understanding their preferences and needs
- Suggesting relevant products based on browsing/purchase history
- Highlighting promotions and deals
- Cross-selling and upselling appropriately

Be helpful but not pushy. Always prioritize customer satisfaction over sales.`,
    capabilities: ["chat", "web_search", "webhook_call"],
    model: "claude-sonnet-4.5",
    examples: [
      "Recommend a gift for a 10-year-old who likes science",
      "What goes well with this jacket?",
      "Show me products similar to item #456",
      "What's on sale this week?",
    ],
    requiredWebhooks: ["pos", "inventory"],
    config: {
      maxRecommendations: 5,
      includeOutOfStock: false,
    },
  },
  {
    id: "returns-processor",
    name: "Returns & Refunds Agent",
    description: "Handles return requests, refunds, and exchanges",
    category: "customer_service",
    systemPrompt: `You are a returns and refunds specialist for a retail store.
Your responsibilities:
- Process return and exchange requests
- Verify return eligibility (time window, condition, receipt)
- Initiate refunds
- Arrange product pickups or dropoffs
- Handle return-related customer concerns

Follow store return policy strictly. Be empathetic but firm on policy requirements.`,
    capabilities: ["chat", "webhook_call", "file_read"],
    model: "claude-haiku-4.5",
    examples: [
      "I want to return order #789",
      "Can I exchange this for a different size?",
      "When will I get my refund?",
      "The product arrived damaged",
    ],
    requiredWebhooks: ["pos", "crm"],
    config: {
      returnWindowDays: 30,
      requiresReceipt: true,
    },
  },
];

/**
 * Agent Template Registry manages pre-built and custom templates.
 */
export class AgentTemplateRegistry {
  private templates: Map<string, AgentTemplate>;

  constructor() {
    this.templates = new Map();

    // Load built-in templates
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Get a template by ID.
   */
  getTemplate(id: string): AgentTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * List all available templates.
   */
  listTemplates(category?: AgentTemplate["category"]): AgentTemplate[] {
    const all = Array.from(this.templates.values());
    if (category) {
      return all.filter((t) => t.category === category);
    }
    return all;
  }

  /**
   * Create a custom template.
   */
  createCustomTemplate(template: AgentTemplate): void {
    if (this.templates.has(template.id)) {
      throw new Error(`Template already exists: ${template.id}`);
    }
    this.templates.set(template.id, template);
  }

  /**
   * Customize an existing template.
   */
  customizeTemplate(
    templateId: string,
    customizations: CustomizationOptions
  ): AgentTemplate {
    const base = this.templates.get(templateId);
    if (!base) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const customized: AgentTemplate = {
      ...base,
      id: `${base.id}-custom-${Date.now()}`,
      name: `${base.name} (Custom)`,
    };

    // Apply customizations
    if (customizations.systemPrompt) {
      customized.systemPrompt = customizations.systemPrompt;
    }

    if (customizations.capabilities) {
      const caps = new Set(base.capabilities);

      if (customizations.capabilities.add) {
        for (const cap of customizations.capabilities.add) {
          caps.add(cap);
        }
      }

      if (customizations.capabilities.remove) {
        for (const cap of customizations.capabilities.remove) {
          caps.delete(cap);
        }
      }

      customized.capabilities = Array.from(caps);
    }

    if (customizations.model) {
      customized.model = customizations.model;
    }

    if (customizations.config) {
      customized.config = {
        ...base.config,
        ...customizations.config,
      };
    }

    // Register customized template
    this.templates.set(customized.id, customized);

    return customized;
  }

  /**
   * Remove a custom template (cannot remove built-in templates).
   */
  removeTemplate(id: string): boolean {
    const template = this.templates.get(id);
    if (!template) {
      return false;
    }

    // Prevent removal of built-in templates
    const isBuiltIn = BUILTIN_TEMPLATES.some((t) => t.id === id);
    if (isBuiltIn) {
      throw new Error(`Cannot remove built-in template: ${id}`);
    }

    return this.templates.delete(id);
  }

  /**
   * Generate OpenClaw agent configuration from a template.
   */
  generateAgentConfig(
    templateId: string,
    tenantId: string,
    agentName: string,
    overrides?: Record<string, unknown>
  ): Record<string, unknown> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return {
      agentId: `${tenantId}-${agentName}`,
      template: {
        id: template.id,
        name: template.name,
        category: template.category,
      },
      systemPrompt: template.systemPrompt,
      model: template.model ?? "claude-sonnet-4.5",
      capabilities: template.capabilities,
      webhooks: template.requiredWebhooks ?? [],
      config: {
        ...template.config,
        ...overrides,
      },
      hierarchy: {
        level: 2, // Worker
        lead: `${tenantId}-admin`,
      },
    };
  }

  /**
   * Validate that a template has required webhooks configured.
   */
  validateWebhooks(
    templateId: string,
    availableWebhooks: string[]
  ): { valid: boolean; missing: string[] } {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const required = template.requiredWebhooks ?? [];
    const missing = required.filter((w) => !availableWebhooks.includes(w));

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * Get template recommendations based on tenant needs.
   */
  recommendTemplates(keywords: string[]): AgentTemplate[] {
    const keywordsLower = keywords.map((k) => k.toLowerCase());
    const scored: Array<{ template: AgentTemplate; score: number }> = [];

    for (const template of this.templates.values()) {
      let score = 0;

      const searchText = `${template.name} ${template.description} ${template.category}`.toLowerCase();

      for (const keyword of keywordsLower) {
        if (searchText.includes(keyword)) {
          score += 1;
        }
      }

      if (template.examples) {
        const examplesText = template.examples.join(" ").toLowerCase();
        for (const keyword of keywordsLower) {
          if (examplesText.includes(keyword)) {
            score += 0.5;
          }
        }
      }

      if (score > 0) {
        scored.push({ template, score });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .map((s) => s.template)
      .slice(0, 5);
  }
}
