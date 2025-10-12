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
		const [salt, originalHex] = stored.split(":");
		const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
		const originalKey = Buffer.from(originalHex, "hex");

		// Important: prevent timing attacks
		return timingSafeEqual(derivedKey, originalKey);
	}

	public randomUUID(): string {
		return randomUUID();
	}
}
