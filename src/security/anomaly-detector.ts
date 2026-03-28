export type AnomalyType =
	| "exec_frequency"
	| "new_tool"
	| "off_hours"
	| "data_volume"
	| "failed_auth"
	| "suspicious_path";

export interface AgentActivity {
	agentId: string;
	timestamp: number;
	activityType: "exec" | "tool_use" | "file_access" | "network_request" | "auth_attempt";
	toolName?: string;
	dataBytes?: number;
	success?: boolean;
	path?: string;
}

export interface BaselineProfile {
	agentId: string;
	avgExecsPerHour: number;
	knownTools: Set<string>;
	typicalHours: Set<number>; // 0-23
	avgDataBytesPerHour: number;
	createdAt: number;
	updatedAt: number;
	activityCount: number;
}

export interface AnomalyThresholds {
	execFrequencyMultiplier: number; // Alert if > baseline * multiplier
	offHoursSensitivity: number; // 0-1, higher = more sensitive
	dataVolumeMultiplier: number; // Alert if > baseline * multiplier
	failedAuthThreshold: number; // Alert after N failures
}

export interface Anomaly {
	agentId: string;
	type: AnomalyType;
	severity: number; // 0-1
	timestamp: number;
	details: string;
	activity: AgentActivity;
}

export interface AnomalyDetectorConfig {
	thresholds: AnomalyThresholds;
	baselineWindow: number; // milliseconds to establish baseline
	learningMode?: boolean; // if true, don't alert during baseline building
}

export class AnomalyDetector {
	private readonly thresholds: AnomalyThresholds;
	private readonly baselineWindow: number;
	private readonly learningMode: boolean;
	private readonly baselines: Map<string, BaselineProfile>;
	private readonly recentActivity: Map<string, AgentActivity[]>;
	private readonly anomalies: Anomaly[];

	constructor(config: AnomalyDetectorConfig) {
		this.thresholds = config.thresholds;
		this.baselineWindow = config.baselineWindow;
		this.learningMode = config.learningMode ?? false;
		this.baselines = new Map();
		this.recentActivity = new Map();
		this.anomalies = [];
	}

	private getOrCreateBaseline(agentId: string): BaselineProfile {
		let baseline = this.baselines.get(agentId);
		if (!baseline) {
			baseline = {
				agentId,
				avgExecsPerHour: 0,
				knownTools: new Set(),
				typicalHours: new Set(),
				avgDataBytesPerHour: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				activityCount: 0,
			};
			this.baselines.set(agentId, baseline);
		}
		return baseline;
	}

	private updateBaseline(agentId: string, activity: AgentActivity): void {
		const baseline = this.getOrCreateBaseline(agentId);

		baseline.activityCount++;
		baseline.updatedAt = Date.now();

		// Update known tools
		if (activity.toolName) {
			baseline.knownTools.add(activity.toolName);
		}

		// Update typical hours
		const hour = new Date(activity.timestamp).getHours();
		baseline.typicalHours.add(hour);

		// Update exec frequency (smoothed average)
		if (activity.activityType === "exec") {
			const alpha = 0.1; // smoothing factor
			baseline.avgExecsPerHour = alpha * 1 + (1 - alpha) * baseline.avgExecsPerHour;
		}

		// Update data volume (smoothed average)
		if (activity.dataBytes !== undefined) {
			const alpha = 0.1;
			baseline.avgDataBytesPerHour = alpha * activity.dataBytes + (1 - alpha) * baseline.avgDataBytesPerHour;
		}
	}

	private isBaselineEstablished(agentId: string): boolean {
		const baseline = this.baselines.get(agentId);
		if (!baseline) return false;

		const age = Date.now() - baseline.createdAt;
		return age >= this.baselineWindow && baseline.activityCount >= 10;
	}

	private detectExecFrequencyAnomaly(agentId: string, activity: AgentActivity): Anomaly | null {
		if (activity.activityType !== "exec") return null;

		const baseline = this.baselines.get(agentId);
		if (!baseline || baseline.avgExecsPerHour === 0) return null;

		const recent = this.recentActivity.get(agentId) ?? [];
		const lastHour = recent.filter(
			(a) => a.activityType === "exec" && Date.now() - a.timestamp < 60 * 60 * 1000
		);

		const currentRate = lastHour.length;
		const threshold = baseline.avgExecsPerHour * this.thresholds.execFrequencyMultiplier;

		if (currentRate > threshold) {
			return {
				agentId,
				type: "exec_frequency",
				severity: Math.min(1, currentRate / threshold - 1),
				timestamp: Date.now(),
				details: `Exec rate ${currentRate}/hour exceeds baseline ${baseline.avgExecsPerHour.toFixed(1)}/hour by ${this.thresholds.execFrequencyMultiplier}x`,
				activity,
			};
		}

		return null;
	}

	private detectNewToolAnomaly(agentId: string, activity: AgentActivity): Anomaly | null {
		if (activity.activityType !== "tool_use" || !activity.toolName) return null;

		const baseline = this.baselines.get(agentId);
		if (!baseline) return null;

		if (!baseline.knownTools.has(activity.toolName)) {
			return {
				agentId,
				type: "new_tool",
				severity: 0.6,
				timestamp: Date.now(),
				details: `Agent using new tool: ${activity.toolName}`,
				activity,
			};
		}

		return null;
	}

	private detectOffHoursAnomaly(agentId: string, activity: AgentActivity): Anomaly | null {
		const baseline = this.baselines.get(agentId);
		if (!baseline || baseline.typicalHours.size === 0) return null;

		const hour = new Date(activity.timestamp).getHours();

		if (!baseline.typicalHours.has(hour)) {
			return {
				agentId,
				type: "off_hours",
				severity: this.thresholds.offHoursSensitivity,
				timestamp: Date.now(),
				details: `Activity at unusual hour: ${hour}:00`,
				activity,
			};
		}

		return null;
	}

	private detectDataVolumeAnomaly(agentId: string, activity: AgentActivity): Anomaly | null {
		if (activity.dataBytes === undefined) return null;

		const baseline = this.baselines.get(agentId);
		if (!baseline || baseline.avgDataBytesPerHour === 0) return null;

		const threshold = baseline.avgDataBytesPerHour * this.thresholds.dataVolumeMultiplier;

		if (activity.dataBytes > threshold) {
			return {
				agentId,
				type: "data_volume",
				severity: Math.min(1, activity.dataBytes / threshold - 1),
				timestamp: Date.now(),
				details: `Data volume ${activity.dataBytes} bytes exceeds baseline ${baseline.avgDataBytesPerHour.toFixed(0)} bytes by ${this.thresholds.dataVolumeMultiplier}x`,
				activity,
			};
		}

		return null;
	}

	private detectFailedAuthAnomaly(agentId: string, activity: AgentActivity): Anomaly | null {
		if (activity.activityType !== "auth_attempt" || activity.success !== false) return null;

		const recent = this.recentActivity.get(agentId) ?? [];
		const recentFailed = recent.filter(
			(a) =>
				a.activityType === "auth_attempt" &&
				a.success === false &&
				Date.now() - a.timestamp < 5 * 60 * 1000 // last 5 minutes
		);

		if (recentFailed.length >= this.thresholds.failedAuthThreshold) {
			return {
				agentId,
				type: "failed_auth",
				severity: 0.9,
				timestamp: Date.now(),
				details: `${recentFailed.length} failed auth attempts in 5 minutes`,
				activity,
			};
		}

		return null;
	}

	private detectSuspiciousPathAnomaly(agentId: string, activity: AgentActivity): Anomaly | null {
		if (activity.activityType !== "file_access" || !activity.path) return null;

		const suspiciousPatterns = [
			/\/etc\/passwd/,
			/\/etc\/shadow/,
			/\.ssh\/id_rsa/,
			/\.aws\/credentials/,
			/\.env/,
		];

		for (const pattern of suspiciousPatterns) {
			if (pattern.test(activity.path)) {
				return {
					agentId,
					type: "suspicious_path",
					severity: 0.95,
					timestamp: Date.now(),
					details: `Access to sensitive path: ${activity.path}`,
					activity,
				};
			}
		}

		return null;
	}

	recordActivity(activity: AgentActivity): Anomaly[] {
		const { agentId } = activity;

		// Store recent activity
		const recent = this.recentActivity.get(agentId) ?? [];
		recent.push(activity);

		// Keep only last hour of activity
		const cutoff = Date.now() - 60 * 60 * 1000;
		const filtered = recent.filter((a) => a.timestamp > cutoff);
		this.recentActivity.set(agentId, filtered);

		// Update baseline
		this.updateBaseline(agentId, activity);

		// Skip detection during learning mode if baseline not established
		if (this.learningMode && !this.isBaselineEstablished(agentId)) {
			return [];
		}

		// Detect anomalies
		const detectedAnomalies: Anomaly[] = [];

		const detectors = [
			this.detectExecFrequencyAnomaly.bind(this),
			this.detectNewToolAnomaly.bind(this),
			this.detectOffHoursAnomaly.bind(this),
			this.detectDataVolumeAnomaly.bind(this),
			this.detectFailedAuthAnomaly.bind(this),
			this.detectSuspiciousPathAnomaly.bind(this),
		];

		for (const detector of detectors) {
			const anomaly = detector(agentId, activity);
			if (anomaly) {
				detectedAnomalies.push(anomaly);
				this.anomalies.push(anomaly);
			}
		}

		return detectedAnomalies;
	}

	getAnomalies(agentId?: string, type?: AnomalyType): Anomaly[] {
		let filtered = this.anomalies;

		if (agentId) {
			filtered = filtered.filter((a) => a.agentId === agentId);
		}

		if (type) {
			filtered = filtered.filter((a) => a.type === type);
		}

		return filtered;
	}

	getBaseline(agentId: string): BaselineProfile | undefined {
		return this.baselines.get(agentId);
	}

	clearAnomalies(agentId?: string): void {
		if (agentId) {
			const filtered = this.anomalies.filter((a) => a.agentId !== agentId);
			this.anomalies.length = 0;
			this.anomalies.push(...filtered);
		} else {
			this.anomalies.length = 0;
		}
	}

	resetBaseline(agentId: string): void {
		this.baselines.delete(agentId);
		this.recentActivity.delete(agentId);
	}
}
