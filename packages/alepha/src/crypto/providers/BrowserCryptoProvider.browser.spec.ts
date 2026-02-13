import { describe, expect, it } from "vitest";
import { BrowserCryptoProvider } from "./BrowserCryptoProvider.ts";

describe("BrowserCryptoProvider", () => {
  it("should throw on hashPassword", () => {
    const crypto = new BrowserCryptoProvider();

    expect(() => crypto.hashPassword()).toThrow("not supported in the browser");
  });

  it("should throw on verifyPassword", () => {
    const crypto = new BrowserCryptoProvider();

    expect(() => crypto.verifyPassword()).toThrow(
      "not supported in the browser",
    );
  });

  it("should produce a deterministic sha256 hash", async () => {
    const crypto = new BrowserCryptoProvider();

    const a = await crypto.hash("hello");
    const b = await crypto.hash("hello");
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it("should produce different hashes for different inputs", async () => {
    const crypto = new BrowserCryptoProvider();

    expect(await crypto.hash("a")).not.toEqual(await crypto.hash("b"));
  });

  it("should produce a deterministic hmac", async () => {
    const crypto = new BrowserCryptoProvider();

    const a = await crypto.hmac("payload", "secret");
    const b = await crypto.hmac("payload", "secret");
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it("should produce different hmacs for different secrets", async () => {
    const crypto = new BrowserCryptoProvider();

    const a = await crypto.hmac("payload", "key1");
    const b = await crypto.hmac("payload", "key2");
    expect(a).not.toEqual(b);
  });

  it("should verify a valid hmac", async () => {
    const crypto = new BrowserCryptoProvider();

    const sig = await crypto.hmac("data", "secret");
    expect(await crypto.verifyHmac("data", sig, "secret")).toBe(true);
  });

  it("should reject an invalid hmac", async () => {
    const crypto = new BrowserCryptoProvider();

    const sig = await crypto.hmac("data", "secret");
    expect(await crypto.verifyHmac("tampered", sig, "secret")).toBe(false);
    expect(await crypto.verifyHmac("data", "badsig", "secret")).toBe(false);
    expect(await crypto.verifyHmac("data", sig, "wrongkey")).toBe(false);
  });

  it("should encrypt and decrypt a string", async () => {
    const crypto = new BrowserCryptoProvider();

    const encrypted = await crypto.encrypt("hello world", "mykey");
    expect(encrypted).toContain(":");
    expect(encrypted).not.toContain("hello");

    const decrypted = await crypto.decrypt(encrypted, "mykey");
    expect(decrypted).toEqual("hello world");
  });

  it("should produce different ciphertexts for same plaintext", async () => {
    const crypto = new BrowserCryptoProvider();

    const a = await crypto.encrypt("same", "key");
    const b = await crypto.encrypt("same", "key");
    expect(a).not.toEqual(b);
  });

  it("should fail to decrypt with wrong key", async () => {
    const crypto = new BrowserCryptoProvider();

    const encrypted = await crypto.encrypt("secret", "correct");
    await expect(() => crypto.decrypt(encrypted, "wrong")).rejects.toThrow();
  });

  it("should fail to decrypt invalid ciphertext format", async () => {
    const crypto = new BrowserCryptoProvider();

    await expect(() => crypto.decrypt("invalid", "key")).rejects.toThrow(
      "Invalid ciphertext format",
    );
  });

  it("should handle unicode in encrypt/decrypt", async () => {
    const crypto = new BrowserCryptoProvider();

    const plaintext = "Hello 世界 🌍";
    const encrypted = await crypto.encrypt(plaintext, "key");
    expect(await crypto.decrypt(encrypted, "key")).toEqual(plaintext);
  });

  it("should compare strings in constant time", () => {
    const crypto = new BrowserCryptoProvider();

    expect(crypto.equals("abc", "abc")).toBe(true);
    expect(crypto.equals("abc", "xyz")).toBe(false);
    expect(crypto.equals("short", "longer")).toBe(false);
  });

  it("should generate a valid UUID", () => {
    const crypto = new BrowserCryptoProvider();

    const uuid = crypto.randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should generate unique UUIDs", () => {
    const crypto = new BrowserCryptoProvider();

    expect(crypto.randomUUID()).not.toEqual(crypto.randomUUID());
  });

  it("should generate random text of requested length", () => {
    const crypto = new BrowserCryptoProvider();

    expect(crypto.randomText(16)).toHaveLength(16);
    expect(crypto.randomText(32)).toHaveLength(32);
    expect(crypto.randomText(1)).toHaveLength(1);
  });

  it("should generate url-safe random text", () => {
    const crypto = new BrowserCryptoProvider();

    const text = crypto.randomText(100);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should generate numeric codes of requested length", () => {
    const crypto = new BrowserCryptoProvider();

    const code = crypto.randomCode(6);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("should generate single-digit codes", () => {
    const crypto = new BrowserCryptoProvider();

    const code = crypto.randomCode(1);
    expect(code).toHaveLength(1);
    expect(code).toMatch(/^\d$/);
  });
});
