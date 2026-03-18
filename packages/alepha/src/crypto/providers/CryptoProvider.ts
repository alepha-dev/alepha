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
}
