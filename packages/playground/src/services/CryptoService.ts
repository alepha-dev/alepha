import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const sc = promisify(scrypt);

export class CryptoService {
	private readonly keyLength: number = 64;
	private readonly saltLength: number = 16;

	async hashPassword(password: string): Promise<string> {
		const salt = randomBytes(this.saltLength).toString("hex");
		const derivedKey = (await sc(password, salt, this.keyLength)) as Buffer;
		return `${salt}:${derivedKey.toString("hex")}`;
	}

	async verifyPassword(password: string, storedHash: string): Promise<boolean> {
		const [salt, key] = storedHash.split(":");
		if (!salt || !key) return false;
		const derivedKey = (await sc(password, salt, this.keyLength)) as Buffer;
		return derivedKey.toString("hex") === key;
	}
}
