import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { CryptoProvider } from "../providers/CryptoProvider.ts";

describe("CryptoProvider", () => {
  it("should hash and verify a password", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const hash = await crypto.hashPassword("secret123");
    expect(hash).toMatch(/^\$scrypt\$ln=14,r=8,p=1\$/);
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

  it("should produce a deterministic sha256 hash", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = await crypto.hash("hello");
    const b = await crypto.hash("hello");
    expect(a).toEqual(b);
    expect(a).toHaveLength(64); // 256 bits = 64 hex chars
  });

  it("should produce different hashes for different inputs", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    expect(await crypto.hash("a")).not.toEqual(await crypto.hash("b"));
  });

  it("should support alternative hash algorithms", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const sha512 = await crypto.hash("hello", "sha512");
    expect(sha512).toHaveLength(128); // 512 bits = 128 hex chars
  });

  it("should produce a deterministic hmac", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = await crypto.hmac("payload", "secret");
    const b = await crypto.hmac("payload", "secret");
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it("should produce different hmacs for different secrets", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = await crypto.hmac("payload", "key1");
    const b = await crypto.hmac("payload", "key2");
    expect(a).not.toEqual(b);
  });

  it("should verify a valid hmac", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const sig = await crypto.hmac("data", "secret");
    expect(await crypto.verifyHmac("data", sig, "secret")).toBe(true);
  });

  it("should reject an invalid hmac", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const sig = await crypto.hmac("data", "secret");
    expect(await crypto.verifyHmac("tampered", sig, "secret")).toBe(false);
    expect(await crypto.verifyHmac("data", "badsig", "secret")).toBe(false);
    expect(await crypto.verifyHmac("data", sig, "wrongkey")).toBe(false);
  });

  it("should encrypt and decrypt a string", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const encrypted = await crypto.encrypt("hello world", "mykey");
    expect(encrypted).toContain(":");
    expect(encrypted).not.toContain("hello");

    const decrypted = await crypto.decrypt(encrypted, "mykey");
    expect(decrypted).toEqual("hello world");
  });

  it("should produce different ciphertexts for same plaintext", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const a = await crypto.encrypt("same", "key");
    const b = await crypto.encrypt("same", "key");
    expect(a).not.toEqual(b);
  });

  it("should fail to decrypt with wrong key", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const encrypted = await crypto.encrypt("secret", "correct");
    await expect(crypto.decrypt(encrypted, "wrong")).rejects.toThrow();
  });

  it("should fail to decrypt invalid ciphertext format", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    await expect(crypto.decrypt("invalid", "key")).rejects.toThrow(
      "Invalid ciphertext format",
    );
  });

  it("should handle unicode in encrypt/decrypt", async () => {
    const crypto = Alepha.create().inject(CryptoProvider);

    const plaintext = "Hello 世界 🌍";
    const encrypted = await crypto.encrypt(plaintext, "key");
    expect(await crypto.decrypt(encrypted, "key")).toEqual(plaintext);
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

  describe("randomUUIDv7", () => {
    const V7_PATTERN =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    it("should generate a canonical version-7 uuid", () => {
      const crypto = Alepha.create().inject(CryptoProvider);

      const uuid = crypto.randomUUIDv7(1_700_000_000_000);
      expect(uuid).toMatch(V7_PATTERN);
    });

    it("should encode the given timestamp in the first 48 bits", () => {
      const crypto = Alepha.create().inject(CryptoProvider);

      const timestamp = 1_700_000_000_123;
      const uuid = crypto.randomUUIDv7(timestamp);
      const tsHex = uuid.slice(0, 8) + uuid.slice(9, 13);
      expect(Number.parseInt(tsHex, 16)).toBe(timestamp);
    });

    it("should sort lexicographically within a single millisecond", () => {
      const crypto = Alepha.create().inject(CryptoProvider);

      const ids = Array.from({ length: 500 }, () =>
        crypto.randomUUIDv7(1_700_000_000_000),
      );
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true);
      }
    });

    it("should keep ordering across a counter overflow in one millisecond", () => {
      const crypto = Alepha.create().inject(CryptoProvider);

      // The 12-bit counter is seeded at or below 0x7ff, so 5000 calls in the
      // same millisecond always overflow at least once and must borrow into
      // the timestamp without breaking the ordering.
      const ids = Array.from({ length: 5000 }, () =>
        crypto.randomUUIDv7(1_700_000_000_000),
      );
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true);
      }
    });

    it("should sort later milliseconds after earlier ones", () => {
      const crypto = Alepha.create().inject(CryptoProvider);

      const earlier = crypto.randomUUIDv7(1_700_000_000_000);
      const later = crypto.randomUUIDv7(1_700_000_000_001);
      expect(later > earlier).toBe(true);
    });

    it("should honor an earlier timestamp when the clock goes backwards", () => {
      const crypto = Alepha.create().inject(CryptoProvider);

      crypto.randomUUIDv7(1_700_000_000_500);
      const rewound = crypto.randomUUIDv7(1_700_000_000_000);
      const tsHex = rewound.slice(0, 8) + rewound.slice(9, 13);
      expect(Number.parseInt(tsHex, 16)).toBe(1_700_000_000_000);
    });
  });
});
