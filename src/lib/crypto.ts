import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { hostname, homedir } from "os";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 16;
const SALT_LEN = 16;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN);
}

function getMachineId(): string {
  return `${hostname()}-${homedir()}`;
}

export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(getMachineId(), salt);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, encrypted].map((b) => b.toString("hex")).join(":");
}

export function decrypt(encoded: string): string {
  const [saltHex, ivHex, tagHex, dataHex] = encoded.split(":");
  if (!saltHex || !ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted format");
  const salt = Buffer.from(saltHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const key = deriveKey(getMachineId(), salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}
