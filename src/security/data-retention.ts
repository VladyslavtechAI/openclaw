import { existsSync, readdirSync, statSync, unlinkSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DataType = "audit_logs" | "session_logs" | "temp_files" | "credentials" | "secrets";

export interface RetentionPolicy {
	dataType: DataType;
	retentionDays: number;
	autoCleanup: boolean;
}

export interface DataRetentionConfig {
	policies: RetentionPolicy[];
	basePaths: Map<DataType, string>;
}

export interface CleanupResult {
	dataType: DataType;
	filesDeleted: number;
	bytesFreed: number;
	errors: string[];
}

export interface ErasureRequest {
	agentId?: string;
	dataTypes: DataType[];
	olderThanDays?: number;
}

export interface ErasureResult {
	totalFiles: number;
	totalBytes: number;
	byDataType: Map<DataType, CleanupResult>;
}

export class DataRetention {
	private readonly policies: Map<DataType, RetentionPolicy>;
	private readonly basePaths: Map<DataType, string>;
	private cleanupIntervalId?: ReturnType<typeof setInterval>;

	constructor(config: DataRetentionConfig) {
		this.policies = new Map();
		for (const policy of config.policies) {
			this.policies.set(policy.dataType, policy);
		}

		this.basePaths = config.basePaths;
	}

	private isExpired(filePath: string, retentionDays: number): boolean {
		try {
			const stats = statSync(filePath);
			const ageMs = Date.now() - stats.mtimeMs;
			const ageDays = ageMs / (1000 * 60 * 60 * 24);
			return ageDays > retentionDays;
		} catch {
			return false;
		}
	}

	private cleanupDirectory(
		dirPath: string,
		retentionDays: number,
		agentFilter?: string
	): { filesDeleted: number; bytesFreed: number; errors: string[] } {
		let filesDeleted = 0;
		let bytesFreed = 0;
		const errors: string[] = [];

		if (!existsSync(dirPath)) {
			return { filesDeleted, bytesFreed, errors };
		}

		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = join(dirPath, entry.name);

				// Agent filtering for subdirectories
				if (agentFilter && entry.isDirectory() && entry.name !== agentFilter) {
					continue;
				}

				if (entry.isDirectory()) {
					const subResult = this.cleanupDirectory(fullPath, retentionDays, agentFilter);
					filesDeleted += subResult.filesDeleted;
					bytesFreed += subResult.bytesFreed;
					errors.push(...subResult.errors);
				} else if (entry.isFile()) {
					try {
						if (this.isExpired(fullPath, retentionDays)) {
							const stats = statSync(fullPath);
							unlinkSync(fullPath);
							filesDeleted++;
							bytesFreed += stats.size;
						}
					} catch (error) {
						errors.push(`Failed to delete ${fullPath}: ${error}`);
					}
				}
			}
		} catch (error) {
			errors.push(`Failed to read directory ${dirPath}: ${error}`);
		}

		return { filesDeleted, bytesFreed, errors };
	}

	cleanupDataType(dataType: DataType, agentFilter?: string): CleanupResult {
		const policy = this.policies.get(dataType);
		const basePath = this.basePaths.get(dataType);

		if (!policy || !basePath) {
			return {
				dataType,
				filesDeleted: 0,
				bytesFreed: 0,
				errors: [`No policy or path configured for ${dataType}`],
			};
		}

		const { filesDeleted, bytesFreed, errors } = this.cleanupDirectory(
			basePath,
			policy.retentionDays,
			agentFilter
		);

		return {
			dataType,
			filesDeleted,
			bytesFreed,
			errors,
		};
	}

	cleanupAll(): CleanupResult[] {
		const results: CleanupResult[] = [];

		for (const [dataType, policy] of this.policies.entries()) {
			if (policy.autoCleanup) {
				results.push(this.cleanupDataType(dataType));
			}
		}

		return results;
	}

	eraseData(request: ErasureRequest): ErasureResult {
		const byDataType = new Map<DataType, CleanupResult>();
		let totalFiles = 0;
		let totalBytes = 0;

		for (const dataType of request.dataTypes) {
			const policy = this.policies.get(dataType);
			const basePath = this.basePaths.get(dataType);

			if (!policy || !basePath) {
				byDataType.set(dataType, {
					dataType,
					filesDeleted: 0,
					bytesFreed: 0,
					errors: [`No policy or path configured for ${dataType}`],
				});
				continue;
			}

			// Use custom retention period if specified, otherwise erase everything
			const retentionDays = request.olderThanDays ?? 0;

			const result = this.cleanupDirectory(basePath, retentionDays, request.agentId);

			totalFiles += result.filesDeleted;
			totalBytes += result.bytesFreed;

			byDataType.set(dataType, {
				dataType,
				filesDeleted: result.filesDeleted,
				bytesFreed: result.bytesFreed,
				errors: result.errors,
			});
		}

		return {
			totalFiles,
			totalBytes,
			byDataType,
		};
	}

	startAutoCleanup(intervalMs: number = 24 * 60 * 60 * 1000): void {
		if (this.cleanupIntervalId) {
			this.stopAutoCleanup();
		}

		this.cleanupIntervalId = setInterval(() => {
			this.cleanupAll();
		}, intervalMs);
	}

	stopAutoCleanup(): void {
		if (this.cleanupIntervalId) {
			clearInterval(this.cleanupIntervalId);
			this.cleanupIntervalId = undefined;
		}
	}

	getPolicy(dataType: DataType): RetentionPolicy | undefined {
		return this.policies.get(dataType);
	}

	setPolicy(policy: RetentionPolicy): void {
		this.policies.set(policy.dataType, policy);
	}

	getPolicies(): RetentionPolicy[] {
		return Array.from(this.policies.values());
	}
}
