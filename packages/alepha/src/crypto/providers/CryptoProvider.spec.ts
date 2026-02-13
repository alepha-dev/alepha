import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { CryptoProvider } from "./CryptoProvider.ts";

describe("CryptoProvider", () => {
  it("should hash and verify a password", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const hash = await crypto.hashPassword("secret123");
    expect(hash).toContain(":");
    expect(await crypto.verifyPassword("secret123", hash)).toBe(true);
  });

  it("should reject wrong password", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const hash = await crypto.hashPassword("correct");
    expect(await crypto.verifyPassword("wrong", hash)).toBe(false);
  });

  it("should produce different hashes for same password", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const hash1 = await crypto.hashPassword("same");
    const hash2 = await crypto.hashPassword("same");
    expect(hash1).not.toEqual(hash2);
  });

  it("should reject invalid stored hash formats", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    expect(await crypto.verifyPassword("any", "")).toBe(false);
    expect(await crypto.verifyPassword("any", "nocolon")).toBe(false);
    expect(await crypto.verifyPassword("any", "a:b:c")).toBe(false);
    expect(await crypto.verifyPassword("any", ":hash")).toBe(false);
    expect(await crypto.verifyPassword("any", "salt:")).toBe(false);
    expect(await crypto.verifyPassword("any", "salt:invalidhex!")).toBe(false);
    expect(await crypto.verifyPassword("any", "salt:abc")).toBe(false); // odd-length hex
  });

  it("should generate a valid UUID", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should generate unique UUIDs", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(a).not.toEqual(b);
  });

  it("should generate random text of requested length", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    expect(crypto.randomText(16)).toHaveLength(16);
    expect(crypto.randomText(32)).toHaveLength(32);
    expect(crypto.randomText(1)).toHaveLength(1);
  });

  it("should generate unique random text", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = crypto.randomText(32);
    const b = crypto.randomText(32);
    expect(a).not.toEqual(b);
  });

  it("should generate url-safe random text", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const text = crypto.randomText(100);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should produce a deterministic sha256 hash", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = crypto.hash("hello");
    const b = crypto.hash("hello");
    expect(a).toEqual(b);
    expect(a).toHaveLength(64); // 256 bits = 64 hex chars
  });

  it("should produce different hashes for different inputs", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    expect(crypto.hash("a")).not.toEqual(crypto.hash("b"));
  });

  it("should support alternative hash algorithms", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const sha512 = crypto.hash("hello", "sha512");
    expect(sha512).toHaveLength(128); // 512 bits = 128 hex chars
  });

  it("should produce a deterministic hmac", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = crypto.hmac("payload", "secret");
    const b = crypto.hmac("payload", "secret");
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it("should produce different hmacs for different secrets", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = crypto.hmac("payload", "key1");
    const b = crypto.hmac("payload", "key2");
    expect(a).not.toEqual(b);
  });

  it("should verify a valid hmac", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const sig = crypto.hmac("data", "secret");
    expect(crypto.verifyHmac("data", sig, "secret")).toBe(true);
  });

  it("should reject an invalid hmac", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const sig = crypto.hmac("data", "secret");
    expect(crypto.verifyHmac("tampered", sig, "secret")).toBe(false);
    expect(crypto.verifyHmac("data", "badsig", "secret")).toBe(false);
    expect(crypto.verifyHmac("data", sig, "wrongkey")).toBe(false);
  });

  it("should encrypt and decrypt a string", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const encrypted = crypto.encrypt("hello world", "mykey");
    expect(encrypted).toContain(":");
    expect(encrypted).not.toContain("hello");

    const decrypted = crypto.decrypt(encrypted, "mykey");
    expect(decrypted).toEqual("hello world");
  });

  it("should produce different ciphertexts for same plaintext", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = crypto.encrypt("same", "key");
    const b = crypto.encrypt("same", "key");
    expect(a).not.toEqual(b);
  });

  it("should fail to decrypt with wrong key", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const encrypted = crypto.encrypt("secret", "correct");
    expect(() => crypto.decrypt(encrypted, "wrong")).toThrow();
  });

  it("should fail to decrypt invalid ciphertext format", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    expect(() => crypto.decrypt("invalid", "key")).toThrow(
      "Invalid ciphertext format",
    );
  });

  it("should handle unicode in encrypt/decrypt", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const plaintext = "Hello 世界 🌍";
    const encrypted = crypto.encrypt(plaintext, "key");
    expect(crypto.decrypt(encrypted, "key")).toEqual(plaintext);
  });

  it("should compare strings in constant time", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    expect(crypto.equals("abc", "abc")).toBe(true);
    expect(crypto.equals("abc", "xyz")).toBe(false);
    expect(crypto.equals("short", "longer")).toBe(false);
  });

  it("should generate numeric codes of requested length", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const code = crypto.randomCode(6);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("should pad short codes with leading zeros", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    // Run enough times to statistically hit a code starting with 0
    const codes = Array.from({ length: 100 }, () => crypto.randomCode(6));
    for (const code of codes) {
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("should generate single-digit codes", () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const code = crypto.randomCode(1);
    expect(code).toHaveLength(1);
    expect(code).toMatch(/^\d$/);
  });
});
