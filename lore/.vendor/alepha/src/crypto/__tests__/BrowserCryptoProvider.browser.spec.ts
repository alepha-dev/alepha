import { describe, expect, it } from "vitest";

import { BrowserCryptoProvider } from "../providers/BrowserCryptoProvider.ts";

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

  it("should generate long codes without hanging", () => {
    const crypto = new BrowserCryptoProvider();

    // For length >= 10, `10 ** length` exceeds 2^32, so the rejection-sampling
    // limit floored to 0 and the loop could never exit — a hung tab. The Node
    // impl handles these fine, so the providers must not diverge.
    for (const length of [10, 12, 15]) {
      const code = crypto.randomCode(length);
      expect(code).toHaveLength(length);
      expect(code).toMatch(new RegExp(`^\\d{${length}}$`));
    }
  });

  describe("passphrase-based encryption (protected folios)", () => {
    // Iteration count tuned down for tests — production paths use the
    // 600k default. Using the default here would push the suite well
    // past Vitest's per-test timeout in CI.
    const ITER = 1_000;

    it("round-trips plaintext through encrypt → decrypt", async () => {
      const crypto = new BrowserCryptoProvider();
      const salt = await crypto.hash("salt-seed");
      const key = await crypto.deriveKeyFromPassphrase(
        "correct horse battery staple",
        salt,
        ITER,
      );
      const envelope = await crypto.encryptWithPassphrase(
        "the secret is in the duck pond",
        key,
        salt,
        ITER,
      );
      const out = await crypto.decryptWithPassphrase(
        envelope,
        "correct horse battery staple",
      );
      expect(out).toBe("the secret is in the duck pond");
    });

    it("rejects the wrong passphrase with OperationError-shaped failure", async () => {
      const crypto = new BrowserCryptoProvider();
      const salt = await crypto.hash("salt-seed");
      const key = await crypto.deriveKeyFromPassphrase("right one", salt, ITER);
      const envelope = await crypto.encryptWithPassphrase(
        "loot stash coordinates: 42N, 7E",
        key,
        salt,
        ITER,
      );
      // Web Crypto throws DOMException("OperationError") on auth-tag
      // mismatch. We don't pin the exact class — just that it rejects.
      await expect(
        crypto.decryptWithPassphrase(envelope, "wrong one"),
      ).rejects.toThrow();
    });

    it("emits a fresh IV on every encrypt with the same key", async () => {
      const crypto = new BrowserCryptoProvider();
      const salt = await crypto.hash("salt-seed");
      const key = await crypto.deriveKeyFromPassphrase("pw", salt, ITER);
      const a = JSON.parse(
        await crypto.encryptWithPassphrase("same content", key, salt, ITER),
      ) as { iv: string };
      const b = JSON.parse(
        await crypto.encryptWithPassphrase("same content", key, salt, ITER),
      ) as { iv: string };
      expect(a.iv).not.toBe(b.iv);
    });
  });

  describe("randomUUIDv7", () => {
    it("generates a canonical version-7 uuid encoding the timestamp", () => {
      const crypto = new BrowserCryptoProvider();

      const timestamp = 1_700_000_000_123;
      const uuid = crypto.randomUUIDv7(timestamp);
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      const tsHex = uuid.slice(0, 8) + uuid.slice(9, 13);
      expect(Number.parseInt(tsHex, 16)).toBe(timestamp);
    });

    it("sorts lexicographically within a single millisecond", () => {
      const crypto = new BrowserCryptoProvider();

      const ids = Array.from({ length: 500 }, () =>
        crypto.randomUUIDv7(1_700_000_000_000),
      );
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]! > ids[i - 1]!).toBe(true);
      }
    });
  });
});
