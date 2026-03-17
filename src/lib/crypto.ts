import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

let _generatedSecret: string | undefined;

function getSecret(): string {
  const secret = process.env.DINDANG_ENCRYPTION_SECRET;
  if (secret) return secret;

  const mode = process.env.DINDANG_MODE || "local";
  if (mode === "local") {
    if (!_generatedSecret) {
      _generatedSecret = randomBytes(32).toString("hex");
      console.warn("[crypto] no DINDANG_ENCRYPTION_SECRET set — generated ephemeral secret. Credentials will not persist across restarts. Set DINDANG_ENCRYPTION_SECRET in .env for persistence.");
    }
    return _generatedSecret;
  }

  throw new Error("DINDANG_ENCRYPTION_SECRET environment variable is required");
}

export function deriveKey(scopeId: string): Buffer {
  const secret = getSecret();
  return scryptSync(secret, scopeId, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
}

export function encrypt(plaintext: string, key: Buffer): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [salt, iv, authTag, encrypted].map((b) => b.toString("hex")).join(":");
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted format");
  const [, ivHex, authTagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(authTagHex!, "hex");
  const data = Buffer.from(dataHex!, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final("utf8");
}
