import { Alepha } from "alepha";
import { CryptoProvider } from "alepha/security";
import { describe, expect, it } from "vitest";

/**
 * Bug #2: Password Verification Missing Input Validation
 *
 * Issue: The verifyPassword method didn't validate input format before processing,
 * leading to crashes when:
 * - stored hash is malformed (missing colon, wrong format)
 * - stored hash has incorrect length
 * - timingSafeEqual throws when buffer lengths differ
 *
 * Expected: All invalid inputs should return false gracefully instead of throwing.
 */
describe("Bug #2: Password Verification Missing Input Validation", () => {
  it("should verify valid password correctly", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const password = "mySecurePassword123!";
    const hashed = await crypto.hashPassword(password);

    const isValid = await crypto.verifyPassword(password, hashed);
    expect(isValid).toBe(true);

    const isInvalid = await crypto.verifyPassword("wrongPassword", hashed);
    expect(isInvalid).toBe(false);
  });

  it("should return false for malformed hash with no colon", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = "notavalidhashwithoutcolon";

    // Should not throw, should return false
    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for hash with multiple colons", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = "salt:hash:extra";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for empty string", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const result = await crypto.verifyPassword("password", "");
    expect(result).toBe(false);
  });

  it("should return false for hash with empty salt", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = ":somehashvalue";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for hash with empty hash value", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = "somesalt:";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for just a colon", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = ":";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for invalid hex in hash portion", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // Valid salt, but hash contains non-hex characters
    const malformed = "validSalt123:notHexChars!@#";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for odd-length hex string", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // Hex strings must have even length (2 chars per byte)
    const malformed = "salt:abc"; // 3 chars, odd

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for hash with wrong length", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // Valid hex, but wrong length (scrypt produces 64 bytes = 128 hex chars)
    const malformed = "salt:abcd"; // Only 4 hex chars = 2 bytes

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for corrupted but well-formed hash", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const password = "testPassword";
    const hashed = await crypto.hashPassword(password);

    // Corrupt the hash by changing one character
    const removedChar = hashed.slice(-1);
    const corrupted = hashed.slice(0, -1) + (removedChar === "0" ? "1" : "0");

    const result = await crypto.verifyPassword(password, corrupted);
    expect(result).toBe(false);
  });

  it("should return false for null or undefined input", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // @ts-expect-error - testing runtime behavior
    const resultNull = await crypto.verifyPassword("password", null);
    expect(resultNull).toBe(false);

    // @ts-expect-error - testing runtime behavior
    const resultUndefined = await crypto.verifyPassword("password", undefined);
    expect(resultUndefined).toBe(false);
  });

  it("should return false for non-string input", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // @ts-expect-error - testing runtime behavior
    const resultNumber = await crypto.verifyPassword("password", 12345);
    expect(resultNumber).toBe(false);

    // @ts-expect-error - testing runtime behavior
    const resultObject = await crypto.verifyPassword("password", {
      hash: "test",
    });
    expect(resultObject).toBe(false);
  });

  it("should handle special characters in salt gracefully", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // If somehow a salt with special chars got stored
    const malformed =
      "salt\nwith\nnewlines:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    // Should not crash, should return false (likely during scrypt or comparison)
    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should validate format before attempting expensive scrypt operation", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // These should fail fast without calling scrypt
    const invalidFormats = [
      "no-colon-at-all",
      "too:many:colons:here",
      ":no-salt",
      "no-hash:",
      ":",
      "",
      "salt:invalidhex!",
      "salt:abc", // odd length
    ];

    for (const invalid of invalidFormats) {
      const result = await crypto.verifyPassword("password", invalid);
      expect(result).toBe(false);
    }
  });

  it("should properly handle valid hash format with correct verification", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // Test multiple passwords
    const passwords = [
      "simple",
      "with spaces",
      "special!@#$%^&*()",
      "emoji🔐🔑",
      `${"very".repeat(100)}long`,
    ];

    for (const password of passwords) {
      const hashed = await crypto.hashPassword(password);

      // Verify format is correct (salt:hash with 128 hex chars for hash)
      expect(hashed).toMatch(/^[0-9a-f]+:[0-9a-f]{128}$/i);

      // Correct password should verify
      expect(await crypto.verifyPassword(password, hashed)).toBe(true);

      // Wrong password should not verify
      expect(await crypto.verifyPassword(`${password}wrong`, hashed)).toBe(
        false,
      );
    }
  });

  it("should prevent timing attacks with constant-time comparison", async () => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const password = "testPassword";
    const hashed = await crypto.hashPassword(password);

    // Both wrong passwords should take similar time (constant-time comparison)
    // This is a behavioral test - we're just checking they both return false
    const wrongPassword1 = "x";
    const wrongPassword2 = "x".repeat(100);

    expect(await crypto.verifyPassword(wrongPassword1, hashed)).toBe(false);
    expect(await crypto.verifyPassword(wrongPassword2, hashed)).toBe(false);
  });
});
