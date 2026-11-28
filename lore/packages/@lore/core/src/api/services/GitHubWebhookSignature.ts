/**
 * Checks GitHub's `X-Hub-Signature-256` over a delivery's raw bytes (#Q4360,
 * #Q4364).
 *
 * The header is `sha256=<hex HMAC-SHA256 of the body, keyed on the webhook
 * secret>`. The check is WebCrypto's `verify`, which compares in constant
 * time, on the bytes received: a body parsed and serialized again is not
 * the body GitHub signed. Runs on workerd and Node alike.
 */
export class GitHubWebhookSignature {
  async verify(
    body: Uint8Array,
    header: string | undefined,
    secret: string,
  ): Promise<boolean> {
    const match = /^sha256=([0-9a-f]{64})$/i.exec((header ?? "").trim());
    if (!match || !secret) return false;
    const signature = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      signature[i] = Number.parseInt(match[1].slice(i * 2, i * 2 + 2), 16);
    }
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      body as Uint8Array<ArrayBuffer>,
    );
  }

  /**
   * The header GitHub would send for `body`: for specs and fixtures.
   */
  async sign(body: Uint8Array | string, secret: string): Promise<string> {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : body;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, bytes as Uint8Array<ArrayBuffer>),
    );
    return `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
}
