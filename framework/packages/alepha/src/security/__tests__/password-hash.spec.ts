import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { CryptoProvider } from "../index.ts";

/**
 * `CryptoProvider.verifyPassword` on a stored value that is not a hash it
 * produced: anything but a well-formed PHC scrypt string answers `false`
 * and never throws.
 */
describe("password hash verification", () => {
  it("should verify valid password correctly", async ({ expect }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const password = "mySecurePassword123!";
    const hashed = await crypto.hashPassword(password);

    const isValid = await crypto.verifyPassword(password, hashed);
    expect(isValid).toBe(true);

    const isInvalid = await crypto.verifyPassword("wrongPassword", hashed);
    expect(isInvalid).toBe(false);
  });

  it("should return false for malformed hash with no colon", async ({
    expect,
  }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = "notavalidhashwithoutcolon";

    // Should not throw, should return false
    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for hash with multiple colons", async ({
    expect,
  }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = "salt:hash:extra";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for empty string", async ({ expect }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const result = await crypto.verifyPassword("password", "");
    expect(result).toBe(false);
  });

  it("should return false for hash with empty salt", async ({ expect }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = ":somehashvalue";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for hash with empty hash value", async ({
    expect,
  }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = "somesalt:";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for just a colon", async ({ expect }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    const malformed = ":";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for invalid hex in hash portion", async ({
    expect,
  }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // Valid salt, but hash contains non-hex characters
    const malformed = "validSalt123:notHexChars!@#";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for odd-length hex string", async ({ expect }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // Hex strings must have even length (2 chars per byte)
    const malformed = "salt:abc"; // 3 chars, odd

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for hash with wrong length", async ({ expect }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // Not a PHC string, and far shorter than a 64-byte hash in any encoding
    const malformed = "salt:abcd";

    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should return false for corrupted but well-formed hash", async ({
    expect,
  }) => {
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

  it("should return false for null or undefined input", async ({ expect }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // @ts-expect-error - testing runtime behavior
    const resultNull = await crypto.verifyPassword("password", null);
    expect(resultNull).toBe(false);

    // @ts-expect-error - testing runtime behavior
    const resultUndefined = await crypto.verifyPassword("password", undefined);
    expect(resultUndefined).toBe(false);
  });

  it("should return false for non-string input", async ({ expect }) => {
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

  it("should handle special characters in salt gracefully", async ({
    expect,
  }) => {
    const app = Alepha.create();
    const crypto = app.inject(CryptoProvider);

    // The `salt:hex` shape of an older format, with control characters
    const malformed =
      "salt\nwith\nnewlines:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    // Should not crash, should return false
    const result = await crypto.verifyPassword("password", malformed);
    expect(result).toBe(false);
  });

  it("should properly handle valid hash format with correct verification", async ({
    expect,
  }) => {
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

      // PHC carries the scrypt parameters, a 16-byte salt and a 64-byte hash.
      expect(hashed).toMatch(
        /^\$scrypt\$ln=14,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{86}$/,
      );

      // Correct password should verify
      expect(await crypto.verifyPassword(password, hashed)).toBe(true);

      // Wrong password should not verify
      expect(await crypto.verifyPassword(`${password}wrong`, hashed)).toBe(
        false,
      );
    }
  });
});
