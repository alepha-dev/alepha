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
