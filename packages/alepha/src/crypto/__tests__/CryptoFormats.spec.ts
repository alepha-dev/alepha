import { scryptSync } from "node:crypto";

import { AlephaError } from "alepha";
import { describe, it } from "vitest";

import { BrowserCryptoProvider } from "../providers/BrowserCryptoProvider.ts";
import { CryptoProvider } from "../providers/CryptoProvider.ts";

describe("stored crypto formats", () => {
  it("writes a PHC hash derived from raw salt bytes", async ({ expect }) => {
    const provider = new CryptoProvider();
    const stored = await provider.hashPassword("password");
    const parts = stored.split("$");
    expect(parts.slice(0, 3)).toEqual(["", "scrypt", "ln=14,r=8,p=1"]);
    const salt = Buffer.from(parts[3]!, "base64");
    expect(salt).toHaveLength(16);
    expect(Buffer.from(parts[4]!, "base64")).toEqual(
      scryptSync("password", salt, 64, { N: 16384, r: 8, p: 1 }),
    );
    expect(await provider.verifyPassword("password", stored)).toBe(true);
    expect(await provider.verifyPassword("wrong", stored)).toBe(false);
    expect(provider.needsRehash(stored)).toBe(false);
  });

  it("reads legacy hex-text salts and marks weaker PHC parameters for rehashing", async ({
    expect,
  }) => {
    const provider = new CryptoProvider();
    const salt = "00112233445566778899aabbccddeeff";
    const legacy = `${salt}:${scryptSync("password", salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
    expect(await provider.verifyPassword("password", legacy)).toBe(true);
    expect(provider.needsRehash(legacy)).toBe(true);
    const rawSalt = Buffer.from(salt, "hex");
    const weak = `$scrypt$ln=13,r=8,p=1$${rawSalt.toString("base64").replace(/=+$/, "")}$${scryptSync("password", rawSalt, 64, { N: 8192, r: 8, p: 1 }).toString("base64").replace(/=+$/, "")}`;
    expect(await provider.verifyPassword("password", weak)).toBe(true);
    expect(provider.needsRehash(weak)).toBe(true);
    expect(provider.needsRehash(weak.replace("ln=13", "ln=15"))).toBe(false);
    for (const malformed of [
      "$scrypt$ln=0,r=8,p=1$AA$AA",
      "$scrypt$ln=14,r=0,p=1$AA$AA",
      "$scrypt$ln=14,r=8,p=1$A$AA",
      "$scrypt$ln=14,r=8,p=1$!$AA",
    ]) {
      expect(await provider.verifyPassword("password", malformed)).toBe(false);
    }
  });

  for (const writer of [new CryptoProvider(), new BrowserCryptoProvider()]) {
    it(`reads versioned and legacy ciphertext from ${writer.constructor.name} on both runtimes`, async ({
      expect,
    }) => {
      for (const plaintext of ["payload", ""]) {
        const stored = await writer.encrypt(plaintext, "key");
        expect(stored).toMatch(/^v1:/);
        for (const reader of [
          new CryptoProvider(),
          new BrowserCryptoProvider(),
        ]) {
          expect(await reader.decrypt(stored, "key")).toBe(plaintext);
          expect(await reader.decrypt(stored.slice(3), "key")).toBe(plaintext);
          await expect(
            reader.decrypt(stored.replace("v1:", "v2:"), "key"),
          ).rejects.toThrow(AlephaError);
          await expect(
            reader.decrypt(stored.replace("v1:", "v2:"), "key"),
          ).rejects.toThrow('Unsupported ciphertext version "v2"');
        }
      }
    });
  }

  it("checks passphrase-envelope versions before deriving a key on both runtimes", async ({
    expect,
  }) => {
    const node = new CryptoProvider();
    const browser = new BrowserCryptoProvider();
    const salt = "00112233445566778899aabbccddeeff";
    const key = await node.deriveKeyFromPassphrase("passphrase", salt, 1000);
    const stored = await node.encryptWithPassphrase("payload", key, salt, 1000);
    for (const provider of [node, browser]) {
      expect(await provider.decryptWithPassphrase(stored, "passphrase")).toBe(
        "payload",
      );
      for (const v of [2, undefined]) {
        await expect(
          provider.decryptWithPassphrase(
            JSON.stringify({ ...JSON.parse(stored), v }),
            "passphrase",
          ),
        ).rejects.toThrow(AlephaError);
      }
    }
  });
});
