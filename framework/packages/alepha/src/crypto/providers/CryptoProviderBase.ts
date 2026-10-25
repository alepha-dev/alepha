import { AlephaError } from "alepha";

/**
 * Portable digest vocabulary shared by every runtime.
 */
export type CryptoAlgorithm = "sha256" | "sha384" | "sha512";

/**
 * One public crypto contract. Cryptographic transformations return promises
 * on every runtime; random generation and comparisons remain synchronous.
 * Password hashing is server-only and rejects in the browser.
 */
export abstract class CryptoProviderBase {
  protected readonly passwordParameters = {
    ln: 14,
    r: 8,
    p: 1,
    keyLength: 64,
    saltLength: 16,
  };

  /**
   * Whether a stored password should be upgraded after successful verification.
   * Legacy hashes and parameters below the current policy need rehashing.
   */
  public needsRehash(stored: string): boolean {
    const parsed = this.parsePasswordHash(stored);
    const current = this.passwordParameters;
    return (
      !parsed ||
      parsed.ln < current.ln ||
      parsed.r < current.r ||
      parsed.p < current.p ||
      parsed.hash.length < current.keyLength ||
      parsed.salt.length < current.saltLength
    );
  }

  protected encodePasswordHash(salt: Uint8Array, hash: Uint8Array): string {
    const { ln, r, p } = this.passwordParameters;
    return `$scrypt$ln=${ln},r=${r},p=${p}$${this.encodePasswordBytes(salt)}$${this.encodePasswordBytes(hash)}`;
  }

  protected parsePasswordHash(
    stored: string,
  ):
    | { ln: number; r: number; p: number; salt: Uint8Array; hash: Uint8Array }
    | undefined {
    const match =
      /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
        stored,
      );
    if (!match) return;
    const ln = Number(match[1]);
    const r = Number(match[2]);
    const p = Number(match[3]);
    if (
      !Number.isInteger(ln) ||
      ln < 1 ||
      ln > 30 ||
      !Number.isSafeInteger(r) ||
      r < 1 ||
      !Number.isSafeInteger(p) ||
      p < 1
    )
      return;
    try {
      const salt = Uint8Array.from(atob(match[4]!), (char) =>
        char.charCodeAt(0),
      );
      const hash = Uint8Array.from(atob(match[5]!), (char) =>
        char.charCodeAt(0),
      );
      if (
        !salt.length ||
        !hash.length ||
        this.encodePasswordBytes(salt) !== match[4] ||
        this.encodePasswordBytes(hash) !== match[5]
      )
        return;
      return { ln, r, p, salt, hash };
    } catch {
      return;
    }
  }

  protected encodePasswordBytes(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");
  }

  protected encodeCiphertext(
    iv: string,
    tag: string,
    ciphertext: string,
  ): string {
    return `v1:${iv}:${tag}:${ciphertext}`;
  }

  protected decodeCiphertext(ciphertext: string): [string, string, string] {
    const parts = ciphertext.split(":");
    if (parts.length === 4) {
      const version = parts.shift();
      if (version !== "v1")
        throw new AlephaError(`Unsupported ciphertext version "${version}"`);
    }
    if (
      parts.length !== 3 ||
      !/^[0-9a-f]{24}$/i.test(parts[0]!) ||
      !/^[0-9a-f]{32}$/i.test(parts[1]!) ||
      !/^(?:[0-9a-f]{2})*$/i.test(parts[2]!)
    )
      throw new AlephaError("Invalid ciphertext format");
    return parts as [string, string, string];
  }

  protected assertEnvelopeVersion(version: unknown): void {
    if (version !== 1)
      throw new AlephaError(
        `Unsupported passphrase envelope version "${String(version)}"`,
      );
  }

  public abstract hashPassword(password: string): Promise<string>;
  public abstract verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean>;
  public abstract hash(
    data: string,
    algorithm?: CryptoAlgorithm,
  ): Promise<string>;
  public abstract hmac(
    data: string,
    secret: string,
    algorithm?: CryptoAlgorithm,
  ): Promise<string>;
  public abstract verifyHmac(
    data: string,
    signature: string,
    secret: string,
    algorithm?: CryptoAlgorithm,
  ): Promise<boolean>;
  public abstract encrypt(plaintext: string, key: string): Promise<string>;
  public abstract decrypt(ciphertext: string, key: string): Promise<string>;
  public abstract equals(a: string, b: string): boolean;
  public abstract randomUUID(): string;
  public abstract randomUUIDv7(timestampMs: number): string;
  public abstract randomText(length: number): string;
  public abstract randomCode(length: number): string;
  public abstract randomInt(maxExclusive: number): number;
  public abstract deriveKeyFromPassphrase(
    passphrase: string,
    saltHex: string,
    iterations?: number,
  ): Promise<CryptoKey>;
  public abstract encryptWithPassphrase(
    plaintext: string,
    key: CryptoKey,
    saltHex: string,
    iterations?: number,
  ): Promise<string>;
  public abstract decryptWithPassphrase(
    envelope: string,
    passphrase: string,
  ): Promise<string>;

  protected assertAlgorithm(algorithm: CryptoAlgorithm): void {
    if (
      algorithm !== "sha256" &&
      algorithm !== "sha384" &&
      algorithm !== "sha512"
    ) {
      throw new AlephaError(
        `Unsupported crypto algorithm "${algorithm}": use sha256, sha384 or sha512`,
      );
    }
  }

  protected webAlgorithm(algorithm: CryptoAlgorithm): string {
    this.assertAlgorithm(algorithm);
    return algorithm.replace("sha", "SHA-");
  }
}
