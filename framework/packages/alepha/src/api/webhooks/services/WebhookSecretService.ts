import { $inject, AlephaError } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";

/**
 * Generates, encrypts and decrypts webhook endpoint secrets.
 *
 * A secret is `whsec_` and 32 random bytes in base64, the Standard Webhooks
 * shape. It is stored encrypted with `APP_SECRET` and shown once, at
 * creation and at rotation. A changed or lost `APP_SECRET` makes every
 * stored secret unreadable: {@link decrypt} then throws, and the endpoint
 * needs a rotation.
 */
export class WebhookSecretService {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);

  /**
   * How a signing secret begins.
   */
  public readonly prefix = "whsec_";

  /**
   * A new secret, in clear.
   */
  public generate(): string {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `${this.prefix}${btoa(binary)}`;
  }

  public encrypt(secret: string): Promise<string> {
    return this.crypto.encrypt(secret, this.secrets.secretKey);
  }

  /**
   * Decrypt a stored secret. Throws when it does not decrypt, which means
   * `APP_SECRET` changed or was lost since the secret was written.
   */
  public async decrypt(encrypted: string): Promise<string> {
    try {
      return await this.crypto.decrypt(encrypted, this.secrets.secretKey);
    } catch (error) {
      throw new AlephaError(
        "Webhook endpoint secret does not decrypt with the current APP_SECRET",
        { cause: error },
      );
    }
  }
}
