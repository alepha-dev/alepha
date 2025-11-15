import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export class CryptoProvider {
  public async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex"); // 128-bit salt
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
  }

  public async verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean> {
    // Validate input format
    if (!stored || typeof stored !== "string") {
      return false;
    }

    const parts = stored.split(":");
    if (parts.length !== 2) {
      return false;
    }

    const [salt, originalHex] = parts;

    // Validate salt and hash are non-empty
    if (!salt || !originalHex) {
      return false;
    }

    // Validate hex format (must be even length and valid hex)
    if (originalHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(originalHex)) {
      return false;
    }

    try {
      const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
      const originalKey = Buffer.from(originalHex, "hex");

      // Validate buffer lengths match (scrypt should produce 64 bytes)
      if (derivedKey.length !== originalKey.length) {
        return false;
      }

      // Important: prevent timing attacks
      return timingSafeEqual(derivedKey, originalKey);
    } catch (error) {
      // Handle any errors during verification (e.g., invalid salt encoding)
      return false;
    }
  }

  public randomUUID(): string {
    return randomUUID();
  }
}
