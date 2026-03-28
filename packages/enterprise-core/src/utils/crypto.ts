import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function generateId(prefix?: string): string {
  const id = randomBytes(12).toString("hex");
  return prefix ? `${prefix}_${id}` : id;
}

export interface EncryptedBlob {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (AES-256)");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (AES-256)");
  }
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const ciphertext = Buffer.from(blob.ciphertext, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return require("node:crypto").timingSafeEqual(bufA, bufB) as boolean;
}
