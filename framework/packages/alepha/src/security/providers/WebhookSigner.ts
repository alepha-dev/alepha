import { AlephaError } from "alepha";

/**
 * The headers a signed webhook request carries.
 */
export type WebhookSignatureHeaders = {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
};

/**
 * Signs webhook requests the Standard Webhooks way
 * (https://www.standardwebhooks.com), so a receiver in any language can use
 * an existing verifier.
 *
 * - The signed content is `${id}.${timestamp}.${body}`, where `body` is the
 *   exact bytes sent: serialise once, sign that string, send that string.
 * - The key is the secret's BYTES: the base64 that follows `whsec_`,
 *   decoded.
 * - HMAC-SHA256, base64 output, sent as `webhook-signature: v1,<base64>`.
 *   Several secrets (a rotation's overlap) give several space-separated
 *   signatures.
 *
 * Built on WebCrypto (`crypto.subtle`), so it runs unchanged on Node, Bun
 * and workerd. Not registered by any module: inject it where it is needed,
 * a receiver included, without the webhooks module.
 *
 * @example
 * ```ts
 * class Sender {
 *   signer = $inject(WebhookSigner);
 *
 *   async headers(id: string, body: string, secret: string) {
 *     const timestamp = Math.floor(this.dateTime.nowMillis() / 1000);
 *     return this.signer.headers({ id, timestamp, body, secrets: [secret] });
 *   }
 * }
 * ```
 */
export class WebhookSigner {
  /**
   * How a secret begins.
   */
  public readonly secretPrefix = "whsec_";

  /**
   * The three `webhook-*` headers for one request.
   */
  public async headers(input: {
    id: string;
    timestamp: number;
    body: string | Uint8Array;
    secrets: string[];
  }): Promise<WebhookSignatureHeaders> {
    if (input.secrets.length === 0) {
      throw new AlephaError("A webhook needs at least one secret to sign with");
    }
    const signatures = await Promise.all(
      input.secrets.map((secret) =>
        this.sign(input.id, input.timestamp, input.body, secret),
      ),
    );
    return {
      "webhook-id": input.id,
      "webhook-timestamp": String(input.timestamp),
      "webhook-signature": signatures.map((it) => `v1,${it}`).join(" "),
    };
  }

  /**
   * The base64 HMAC-SHA256 of `${id}.${timestamp}.${body}` under `secret`,
   * without the `v1,` prefix.
   */
  public async sign(
    id: string,
    timestamp: number | string,
    body: string | Uint8Array,
    secret: string,
  ): Promise<string> {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      this.secretBytes(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await globalThis.crypto.subtle.sign(
      "HMAC",
      key,
      this.signedContent(id, String(timestamp), body),
    );
    return this.toBase64(new Uint8Array(signed));
  }

  /**
   * The bytes a signature covers: `id`, `.`, `timestamp`, `.`, then the body
   * exactly as given.
   */
  protected signedContent(
    id: string,
    timestamp: string,
    body: string | Uint8Array,
  ): Uint8Array<ArrayBuffer> {
    const encoder = new TextEncoder();
    const head = encoder.encode(`${id}.${timestamp}.`);
    const tail = typeof body === "string" ? encoder.encode(body) : body;
    const out = new Uint8Array(head.byteLength + tail.byteLength);
    out.set(head, 0);
    out.set(tail, head.byteLength);
    return out;
  }

  /**
   * The HMAC key of a secret: what follows `whsec_`, base64-decoded. A secret
   * without the prefix is decoded whole, as other senders hand them out.
   */
  protected secretBytes(secret: string): Uint8Array<ArrayBuffer> {
    const encoded = secret.startsWith(this.secretPrefix)
      ? secret.slice(this.secretPrefix.length)
      : secret;
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      throw new AlephaError("A webhook secret must be base64 after whsec_");
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  protected toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}
