import type { ScryptOptions } from "node:crypto";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { AlephaError } from "alepha";

export class CryptoProvider {
  protected static readonly SCRYPT_OPTIONS: ScryptOptions = {
    N: 16384,
    r: 8,
    p: 1,
  };
  protected static readonly SCRYPT_KEY_LENGTH = 64;
  protected static readonly SALT_LENGTH = 16;
  protected static readonly AES_ALGORITHM = "aes-256-gcm";
  protected static readonly AES_IV_LENGTH = 12;
  protected static readonly AES_TAG_LENGTH = 16;
  protected static readonly AES_KEY_LENGTH = 32;

  /**
   * UUIDv7 monotonic state — see {@link randomUUIDv7}.
   */
  protected uuidV7EmittedMs = -1;
  protected uuidV7InputMs = -1;
  protected uuidV7Counter = 0;

  public async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(CryptoProvider.SALT_LENGTH).toString("hex");
    const derivedKey = (await this.scryptAsync(
      password,
      salt,
      CryptoProvider.SCRYPT_KEY_LENGTH,
      CryptoProvider.SCRYPT_OPTIONS,
    )) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
  }

  public async verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean> {
    if (!stored || typeof stored !== "string") {
      return false;
    }

    const parts = stored.split(":");
    if (parts.length !== 2) {
      return false;
    }

    const [salt, originalHex] = parts;

    if (!salt || !originalHex) {
      return false;
    }

    if (originalHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(originalHex)) {
      return false;
    }

    try {
      const derivedKey = (await this.scryptAsync(
        password,
        salt,
        CryptoProvider.SCRYPT_KEY_LENGTH,
        CryptoProvider.SCRYPT_OPTIONS,
      )) as Buffer;
      const originalKey = Buffer.from(originalHex, "hex");

      if (derivedKey.length !== originalKey.length) {
        return false;
      }

      return timingSafeEqual(derivedKey, originalKey);
    } catch {
      return false;
    }
  }

  public hash(data: string, algorithm = "sha256"): string {
    return createHash(algorithm).update(data).digest("hex");
  }

  public hmac(data: string, secret: string, algorithm = "sha256"): string {
    return createHmac(algorithm, secret).update(data).digest("hex");
  }

  public verifyHmac(
    data: string,
    signature: string,
    secret: string,
    algorithm = "sha256",
  ): boolean {
    const expected = this.hmac(data, secret, algorithm);
    return this.equals(expected, signature);
  }

  public encrypt(plaintext: string, key: string): string {
    const keyBuffer = this.deriveAesKey(key);
    const iv = randomBytes(CryptoProvider.AES_IV_LENGTH);
    const cipher = createCipheriv(CryptoProvider.AES_ALGORITHM, keyBuffer, iv, {
      authTagLength: CryptoProvider.AES_TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  public decrypt(ciphertext: string, key: string): string {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) {
      throw new AlephaError("Invalid ciphertext format");
    }

    const [ivHex, tagHex, encryptedHex] = parts;
    const keyBuffer = this.deriveAesKey(key);
    const decipher = createDecipheriv(
      CryptoProvider.AES_ALGORITHM,
      keyBuffer,
      Buffer.from(ivHex!, "hex"),
      { authTagLength: CryptoProvider.AES_TAG_LENGTH },
    );
    decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
    return (
      decipher.update(encryptedHex!, "hex", "utf8") + decipher.final("utf8")
    );
  }

  public equals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // Constant-time compare against self to avoid timing leak on length mismatch
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  public randomUUID(): string {
    return randomUUID();
  }

  /**
   * Generate an RFC 9562 UUIDv7 for the given unix-millisecond timestamp.
   *
   * The caller supplies the timestamp (usually `DateTimeProvider.nowMillis()`)
   * so this module stays free of any clock dependency and generated ids follow
   * `travel()` in tests.
   *
   * Within a single millisecond, a 12-bit counter in `rand_a` keeps ids
   * strictly increasing; it is seeded at or below 0x7ff on each new
   * millisecond, guaranteeing at least 2048 increments before it overflows
   * and borrows one millisecond from the timestamp. Lexicographic order of
   * the canonical string therefore matches generation order as long as the
   * supplied timestamps never decrease; a rewound clock is honored as-is.
   */
  public randomUUIDv7(timestampMs: number): string {
    const ms = Math.floor(timestampMs);
    if (ms < 0 || ms > 0xffff_ffff_ffff) {
      throw new AlephaError(
        `UUIDv7 timestamp out of range: ${timestampMs} (expected 0..2^48-1 unix ms)`,
      );
    }

    if (ms < this.uuidV7InputMs || ms > this.uuidV7EmittedMs) {
      this.uuidV7EmittedMs = ms;
      this.uuidV7Counter = randomInt(0x800);
    } else {
      this.uuidV7Counter++;
      if (this.uuidV7Counter > 0xfff) {
        this.uuidV7EmittedMs++;
        this.uuidV7Counter = randomInt(0x800);
      }
    }
    this.uuidV7InputMs = ms;

    return this.formatUuidV7(
      this.uuidV7EmittedMs,
      this.uuidV7Counter,
      randomBytes(8),
    );
  }

  protected formatUuidV7(
    timestampMs: number,
    counter: number,
    rand: Uint8Array,
  ): string {
    const ts = timestampMs.toString(16).padStart(12, "0");
    const seq = counter.toString(16).padStart(3, "0");
    const tail = [
      (rand[0]! & 0x3f) | 0x80,
      rand[1]!,
      rand[2]!,
      rand[3]!,
      rand[4]!,
      rand[5]!,
      rand[6]!,
      rand[7]!,
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return `${ts.slice(0, 8)}-${ts.slice(8)}-7${seq}-${tail.slice(0, 4)}-${tail.slice(4)}`;
  }

  public randomText(length: number): string {
    return randomBytes(length).toString("base64url").slice(0, length);
  }

  public randomCode(length: number): string {
    const max = 10 ** length;
    const code = randomInt(max);
    return String(code).padStart(length, "0");
  }

  protected scryptAsync(
    password: string,
    salt: string,
    keylen: number,
    options: ScryptOptions,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, keylen, options, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  }

  protected deriveAesKey(key: string): Buffer {
    return createHash("sha256")
      .update(key)
      .digest()
      .subarray(0, CryptoProvider.AES_KEY_LENGTH);
  }

  /**
   * Web Crypto API parity with `BrowserCryptoProvider`. Node 18+ exposes
   * `globalThis.crypto.subtle`, so the implementations are the same on
   * both runtimes. Server-side use is unusual — passphrase-derived keys
   * are a browser-only flow in Alepha — but these stubs exist so the
   * type surface matches and shared call sites compile.
   */
  public async deriveKeyFromPassphrase(
    passphrase: string,
    saltHex: string,
    iterations = 600_000,
  ): Promise<CryptoKey> {
    const subtle = (globalThis as { crypto: { subtle: SubtleCrypto } }).crypto
      .subtle;
    const baseKey = await subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: hexToBytes(saltHex).buffer as ArrayBuffer,
        iterations,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  public async encryptWithPassphrase(
    plaintext: string,
    key: CryptoKey,
    saltHex: string,
    iterations = 600_000,
  ): Promise<string> {
    const subtle = (globalThis as { crypto: { subtle: SubtleCrypto } }).crypto
      .subtle;
    const iv = randomBytes(CryptoProvider.AES_IV_LENGTH);
    const encrypted = await subtle.encrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      new TextEncoder().encode(plaintext),
    );
    return JSON.stringify({
      v: 1,
      salt: saltHex,
      iv: iv.toString("hex"),
      ciphertext: Buffer.from(encrypted).toString("hex"),
      kdf: { name: "PBKDF2", iterations, hash: "SHA-256" },
    });
  }

  public async decryptWithPassphrase(
    envelope: string,
    passphrase: string,
  ): Promise<string> {
    const subtle = (globalThis as { crypto: { subtle: SubtleCrypto } }).crypto
      .subtle;
    let parsed: {
      salt?: string;
      iv?: string;
      ciphertext?: string;
      kdf?: { iterations?: number };
    };
    try {
      parsed = JSON.parse(envelope);
    } catch {
      throw new AlephaError("Invalid protected envelope");
    }
    if (!parsed.salt || !parsed.iv || !parsed.ciphertext) {
      throw new AlephaError("Invalid protected envelope");
    }
    const key = await this.deriveKeyFromPassphrase(
      passphrase,
      parsed.salt,
      parsed.kdf?.iterations ?? 600_000,
    );
    const decrypted = await subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(parsed.iv).buffer as ArrayBuffer },
      key,
      hexToBytes(parsed.ciphertext).buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(decrypted);
  }
}

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
  }
  return out;
};
