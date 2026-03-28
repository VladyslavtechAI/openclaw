export type ContentCategory =
	| "harmful"
	| "illegal"
	| "hate_speech"
	| "self_harm"
	| "weapons"
	| "drugs";

export type PolicyAction = "block" | "warn" | "log";

export interface ContentPolicy {
	category: ContentCategory;
	action: PolicyAction;
	threshold: number; // 0-1 confidence threshold
}

export interface ContentSafetyConfig {
	defaultPolicies: ContentPolicy[];
	agentOverrides?: Map<string, ContentPolicy[]>;
}

export interface CheckContentOptions {
	content: string;
	agentId: string;
}

export interface ContentViolation {
	category: ContentCategory;
	severity: number; // 0-1
	action: PolicyAction;
	matched: string[];
}

export interface ContentCheckResult {
	allowed: boolean;
	violations: ContentViolation[];
}

export class ContentSafety {
	private readonly defaultPolicies: Map<ContentCategory, ContentPolicy>;
	private readonly agentOverrides: Map<string, Map<ContentCategory, ContentPolicy>>;

	// Pattern definitions for content detection
	private readonly patterns: Map<ContentCategory, Array<{ pattern: RegExp; severity: number }>> = new Map([
		[
			"harmful",
			[
				{ pattern: /\b(kill|murder|assassinate|poison)\s+(someone|people|person)/gi, severity: 0.9 },
				{ pattern: /\b(instructions|how\s+to)\s+(harm|hurt|injure)/gi, severity: 0.8 },
				{ pattern: /\b(torture|mutilate|dismember)/gi, severity: 0.85 },
			],
		],
		[
			"illegal",
			[
				{ pattern: /\b(steal|theft|robbery|burglary)\s+(credit\s+card|money|bank)/gi, severity: 0.9 },
				{ pattern: /\b(counterfeit|forge|fake)\s+(money|currency|documents)/gi, severity: 0.9 },
				{ pattern: /\b(launder|laundering)\s+money/gi, severity: 0.85 },
				{ pattern: /\b(tax\s+evasion|evade\s+taxes)/gi, severity: 0.7 },
			],
		],
		[
			"hate_speech",
			[
				{ pattern: /\b(racist|racism|bigot|bigotry)\b/gi, severity: 0.7 },
				{ pattern: /\b(nazi|white\s+supremac|kkk)/gi, severity: 0.9 },
				{ pattern: /\b(hate\s+crime|ethnic\s+cleansing|genocide)/gi, severity: 0.95 },
			],
		],
		[
			"self_harm",
			[
				{ pattern: /\b(suicide|kill\s+myself|end\s+my\s+life)/gi, severity: 0.9 },
				{ pattern: /\b(self\s+harm|cut\s+myself|hurt\s+myself)/gi, severity: 0.85 },
				{ pattern: /\b(overdose|lethal\s+dose)/gi, severity: 0.8 },
			],
		],
		[
			"weapons",
			[
				{ pattern: /\b(build|make|create)\s+(bomb|explosive|ied)/gi, severity: 0.95 },
				{ pattern: /\b(3d\s+print|manufacture)\s+(gun|firearm|weapon)/gi, severity: 0.85 },
				{ pattern: /\b(recipe|instructions)\s+(explosive|bomb|grenade)/gi, severity: 0.9 },
			],
		],
		[
			"drugs",
			[
				{ pattern: /\b(synthesize|manufacture|cook)\s+(meth|heroin|fentanyl)/gi, severity: 0.9 },
				{ pattern: /\b(drug\s+recipe|how\s+to\s+make)\s+(cocaine|lsd|mdma)/gi, severity: 0.85 },
				{ pattern: /\b(extract|purify)\s+(opium|morphine)/gi, severity: 0.8 },
			],
		],
	]);

	constructor(config: ContentSafetyConfig) {
		this.defaultPolicies = new Map();
		for (const policy of config.defaultPolicies) {
			this.defaultPolicies.set(policy.category, policy);
		}

		this.agentOverrides = new Map();
		if (config.agentOverrides) {
			for (const [agentId, policies] of config.agentOverrides.entries()) {
				const policyMap = new Map<ContentCategory, ContentPolicy>();
				for (const policy of policies) {
					policyMap.set(policy.category, policy);
				}
				this.agentOverrides.set(agentId, policyMap);
			}
		}
	}

	private getPolicies(agentId: string): Map<ContentCategory, ContentPolicy> {
		return this.agentOverrides.get(agentId) ?? this.defaultPolicies;
	}

	private detectCategory(content: string, category: ContentCategory): { severity: number; matched: string[] } {
		const categoryPatterns = this.patterns.get(category) ?? [];
		let maxSeverity = 0;
		const matched: string[] = [];

		for (const { pattern, severity } of categoryPatterns) {
			const matches = content.match(pattern);
			if (matches) {
				maxSeverity = Math.max(maxSeverity, severity);
				matched.push(...matches);
			}
		}

		return { severity: maxSeverity, matched };
	}

	checkContent(options: CheckContentOptions): ContentCheckResult {
		const { content, agentId } = options;
		const policies = this.getPolicies(agentId);

		const violations: ContentViolation[] = [];
		let blocked = false;

		for (const [category, policy] of policies.entries()) {
			const { severity, matched } = this.detectCategory(content, category);

			if (severity >= policy.threshold) {
				violations.push({
					category,
					severity,
					action: policy.action,
					matched,
				});

				if (policy.action === "block") {
					blocked = true;
				}
			}
		}

		return {
			allowed: !blocked,
			violations,
		};
	}

	setAgentPolicy(agentId: string, policies: ContentPolicy[]): void {
		const policyMap = new Map<ContentCategory, ContentPolicy>();
		for (const policy of policies) {
			policyMap.set(policy.category, policy);
		}
		this.agentOverrides.set(agentId, policyMap);
	}

	removeAgentPolicy(agentId: string): void {
		this.agentOverrides.delete(agentId);
	}

	getAgentPolicies(agentId: string): ContentPolicy[] {
		const policies = this.getPolicies(agentId);
		return Array.from(policies.values());
	}
}
