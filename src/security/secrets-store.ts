import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SecretEntry {
	id: string;
	agentId: string;
	key: string;
	encryptedValue: string;
	iv: string;
	authTag: string;
	createdAt: number;
	rotatedAt?: number;
	version: number;
}

export interface SecretsStoreConfig {
	storePath: string;
	masterPassword: string;
	keyDerivationIterations?: number;
}

export interface StoreSecretOptions {
	agentId: string;
	key: string;
	value: string;
}

export interface GetSecretOptions {
	agentId: string;
	key: string;
}

export interface RotateSecretOptions {
	agentId: string;
	key: string;
	newValue: string;
}

export interface ListSecretsOptions {
	agentId: string;
}

export class SecretsStore {
	private readonly storePath: string;
	private readonly encryptionKey: Buffer;
	private secrets: Map<string, SecretEntry>;

	constructor(config: SecretsStoreConfig) {
		this.storePath = config.storePath;

		// Derive encryption key from master password using PBKDF2
		const iterations = config.keyDerivationIterations ?? 100000;
		this.encryptionKey = pbkdf2Sync(
			config.masterPassword,
			"openclaw-secrets-salt",
			iterations,
			32,
			"sha256"
		);

		this.secrets = new Map();
		this.loadSecrets();
	}

	private loadSecrets(): void {
		if (!existsSync(this.storePath)) {
			mkdirSync(this.storePath, { recursive: true });
			return;
		}

		const storeFile = join(this.storePath, "secrets.json");
		if (!existsSync(storeFile)) {
			return;
		}

		try {
			const data = readFileSync(storeFile, "utf-8");
			const entries: SecretEntry[] = JSON.parse(data);

			for (const entry of entries) {
				this.secrets.set(`${entry.agentId}:${entry.key}`, entry);
			}
		} catch (error) {
			throw new Error(`Failed to load secrets: ${error}`);
		}
	}

	private saveSecrets(): void {
		const storeFile = join(this.storePath, "secrets.json");
		const entries = Array.from(this.secrets.values());

		try {
			writeFileSync(storeFile, JSON.stringify(entries, null, 2), "utf-8");
		} catch (error) {
			throw new Error(`Failed to save secrets: ${error}`);
		}
	}

	private encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
		const iv = randomBytes(16);
		const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);

		let encrypted = cipher.update(plaintext, "utf-8", "hex");
		encrypted += cipher.final("hex");

		const authTag = cipher.getAuthTag();

		return {
			encrypted,
			iv: iv.toString("hex"),
			authTag: authTag.toString("hex"),
		};
	}

	private decrypt(encrypted: string, iv: string, authTag: string): string {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			this.encryptionKey,
			Buffer.from(iv, "hex")
		);

		decipher.setAuthTag(Buffer.from(authTag, "hex"));

		let decrypted = decipher.update(encrypted, "hex", "utf-8");
		decrypted += decipher.final("utf-8");

		return decrypted;
	}

	storeSecret(options: StoreSecretOptions): void {
		const { agentId, key, value } = options;
		const secretKey = `${agentId}:${key}`;

		const { encrypted, iv, authTag } = this.encrypt(value);

		const entry: SecretEntry = {
			id: randomBytes(16).toString("hex"),
			agentId,
			key,
			encryptedValue: encrypted,
			iv,
			authTag,
			createdAt: Date.now(),
			version: 1,
		};

		this.secrets.set(secretKey, entry);
		this.saveSecrets();
	}

	getSecret(options: GetSecretOptions): string | null {
		const { agentId, key } = options;
		const secretKey = `${agentId}:${key}`;

		const entry = this.secrets.get(secretKey);
		if (!entry) {
			return null;
		}

		// Enforce per-agent access control
		if (entry.agentId !== agentId) {
			throw new Error("Access denied: agent cannot access secrets from other agents");
		}

		try {
			return this.decrypt(entry.encryptedValue, entry.iv, entry.authTag);
		} catch (error) {
			throw new Error(`Failed to decrypt secret: ${error}`);
		}
	}

	rotateSecret(options: RotateSecretOptions): void {
		const { agentId, key, newValue } = options;
		const secretKey = `${agentId}:${key}`;

		const existing = this.secrets.get(secretKey);
		if (!existing) {
			throw new Error("Secret not found");
		}

		// Enforce per-agent access control
		if (existing.agentId !== agentId) {
			throw new Error("Access denied: agent cannot rotate secrets from other agents");
		}

		const { encrypted, iv, authTag } = this.encrypt(newValue);

		const updated: SecretEntry = {
			...existing,
			encryptedValue: encrypted,
			iv,
			authTag,
			rotatedAt: Date.now(),
			version: existing.version + 1,
		};

		this.secrets.set(secretKey, updated);
		this.saveSecrets();
	}

	deleteSecret(options: GetSecretOptions): boolean {
		const { agentId, key } = options;
		const secretKey = `${agentId}:${key}`;

		const existing = this.secrets.get(secretKey);
		if (!existing) {
			return false;
		}

		// Enforce per-agent access control
		if (existing.agentId !== agentId) {
			throw new Error("Access denied: agent cannot delete secrets from other agents");
		}

		this.secrets.delete(secretKey);
		this.saveSecrets();
		return true;
	}

	listSecrets(options: ListSecretsOptions): Array<{ key: string; createdAt: number; version: number }> {
		const { agentId } = options;

		const agentSecrets: Array<{ key: string; createdAt: number; version: number }> = [];

		for (const entry of this.secrets.values()) {
			if (entry.agentId === agentId) {
				agentSecrets.push({
					key: entry.key,
					createdAt: entry.createdAt,
					version: entry.version,
				});
			}
		}

		return agentSecrets;
	}

	hasSecret(options: GetSecretOptions): boolean {
		const { agentId, key } = options;
		const secretKey = `${agentId}:${key}`;

		const entry = this.secrets.get(secretKey);
		return entry !== undefined && entry.agentId === agentId;
	}
}
