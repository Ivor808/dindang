import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, deriveKey } from "../crypto";

describe("crypto", () => {
  const originalEnv = process.env.DINDANG_ENCRYPTION_SECRET;

  beforeEach(() => {
    process.env.DINDANG_ENCRYPTION_SECRET = "test-secret-that-is-at-least-32-chars!!";
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.DINDANG_ENCRYPTION_SECRET = originalEnv;
    } else {
      delete process.env.DINDANG_ENCRYPTION_SECRET;
    }
  });

  it("encrypts and decrypts with user-derived key", () => {
    const key = deriveKey("user-123");
    const plaintext = "my-secret-token";
    const encrypted = encrypt(plaintext, key);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  it("produces different ciphertext each time", () => {
    const key = deriveKey("user-123");
    const a = encrypt("same-text", key);
    const b = encrypt("same-text", key);
    expect(a).not.toBe(b);
  });

  it("different scope IDs produce different keys", () => {
    const keyA = deriveKey("user-aaa");
    const keyB = deriveKey("user-bbb");
    const encrypted = encrypt("token", keyA);
    expect(() => decrypt(encrypted, keyB)).toThrow();
  });

  it("throws if DINDANG_ENCRYPTION_SECRET is not set in hosted mode", () => {
    delete process.env.DINDANG_ENCRYPTION_SECRET;
    process.env.DINDANG_MODE = "hosted";
    try {
      expect(() => deriveKey("user-123")).toThrow("DINDANG_ENCRYPTION_SECRET");
    } finally {
      delete process.env.DINDANG_MODE;
    }
  });

  it("generates ephemeral secret in local mode when DINDANG_ENCRYPTION_SECRET is not set", () => {
    delete process.env.DINDANG_ENCRYPTION_SECRET;
    delete process.env.DINDANG_MODE;
    // Should not throw — returns an ephemeral key
    expect(() => deriveKey("user-123")).not.toThrow();
  });

  it("ciphertext has 4 hex parts", () => {
    const key = deriveKey("org-456");
    const encrypted = encrypt("data", key);
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(4);
  });
});
