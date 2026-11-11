import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import type { ServerRequest } from "alepha/server";

import { InvalidWebhookSignatureError } from "../errors/InvalidWebhookSignatureError.ts";
import { WebhookSigner } from "./WebhookSigner.ts";

/**
 * What a verification needs: the request's headers, its RAW body, and the
 * secret (or secrets, mid-rotation) the sender signs with.
 */
export interface WebhookVerifyOptions {
  headers: Headers | Record<string, string | string[] | undefined>;
  /**
   * **The bytes received, not a re-serialised object.** Parsing the JSON
   * and stringifying it again changes the bytes (key order, spacing,
   * escapes), and the signature no longer matches.
   */
  body: string | Uint8Array;
  secret: string | string[];
  /**
   * How far the `webhook-timestamp` may be from now, in seconds, either
   * way. Five minutes by default.
   */
  toleranceSeconds?: number;
}

/**
 * Verifies a Standard Webhooks request (https://www.standardwebhooks.com),
 * from an Alepha app or from any sender that follows the specification.
 *
 * Built on {@link WebhookSigner}, so the scheme is written once, and with no
 * dependency on the webhooks module: an app that only receives imports
 * `alepha/security` alone. Not registered by any module: inject it.
 *
 * - The three `webhook-*` headers must be present.
 * - The timestamp must be within the tolerance (five minutes, both ways),
 *   against `DateTimeProvider`'s clock.
 * - The HMAC is recomputed and compared in constant time against EVERY
 *   `v1,` signature of the header (a rotation sends two), under every
 *   secret given. Signature versions it does not know are ignored.
 *
 * A failure throws {@link InvalidWebhookSignatureError} (401) with a
 * `reason` for the log.
 *
 * @example
 * ```ts
 * class Hooks {
 *   verifier = $inject(WebhookVerifier);
 *
 *   // No `schema.body`: the bytes arrive unread, as the signature needs.
 *   receive = $route({
 *     method: "POST",
 *     path: "/hooks/orders",
 *     handler: async (request) => {
 *       const event = await this.verifier.verifyRequest(request, {
 *         secret: env.ORDERS_WEBHOOK_SECRET,
 *       });
 *       // event.id, event.type, event.data
 *       return "ok";
 *     },
 *   });
 * }
 * ```
 */
export class WebhookVerifier {
  protected readonly signer = $inject(WebhookSigner);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The default tolerance, in seconds.
   */
  public toleranceSeconds = 300;

  /**
   * Verify a request from its headers and raw body. Resolves when it is
   * genuine, throws {@link InvalidWebhookSignatureError} when not.
   *
   * @example
   * ```ts
   * await verifier.verify({
   *   headers: request.headers,
   *   body: rawBody, // the bytes received, never JSON.stringify(parsed)
   *   secret: [currentSecret, previousSecret],
   * });
   * ```
   */
  public async verify(options: WebhookVerifyOptions): Promise<void> {
    const id = this.header(options.headers, "webhook-id");
    const timestamp = this.header(options.headers, "webhook-timestamp");
    const signature = this.header(options.headers, "webhook-signature");
    if (!id || !timestamp || !signature) {
      throw new InvalidWebhookSignatureError({ reason: "headers" });
    }

    const seconds = Number(timestamp);
    const tolerance = options.toleranceSeconds ?? this.toleranceSeconds;
    const now = this.dateTime.nowMillis() / 1000;
    if (
      !/^\d+$/.test(timestamp) ||
      !Number.isFinite(seconds) ||
      Math.abs(now - seconds) > tolerance
    ) {
      throw new InvalidWebhookSignatureError({ reason: "timestamp" });
    }

    const candidates = signature
      .split(" ")
      .filter((it) => it.startsWith("v1,"))
      .map((it) => it.slice(3));
    const secrets = Array.isArray(options.secret)
      ? options.secret
      : [options.secret];
    for (const secret of secrets) {
      const expected = await this.signer.sign(
        id,
        timestamp,
        options.body,
        secret,
      );
      // Every candidate is compared, a match or not, so the time taken does
      // not say which one matched.
      let matched = false;
      for (const candidate of candidates) {
        if (this.crypto.equals(candidate, expected)) matched = true;
      }
      if (matched) return;
    }
    throw new InvalidWebhookSignatureError({ reason: "signature" });
  }

  /**
   * Verify the request a `$route` received and return its parsed body.
   *
   * **Declare the route WITHOUT `schema.body`**: the body is then left
   * unread, and this reads the raw bytes itself (`raw.web.req` on Bun and
   * workerd, the `raw.node.req` stream on the Node server). A route with a
   * body schema has already parsed and consumed it, and the bytes are gone.
   * Keep the route outside `/api`, which is the actions' namespace.
   */
  public async verifyRequest<T = WebhookReceivedEnvelope>(
    request: Pick<ServerRequest, "headers" | "raw">,
    options: Omit<WebhookVerifyOptions, "headers" | "body">,
  ): Promise<T> {
    const body = await this.readBody(request);
    await this.verify({
      ...options,
      headers: request.headers as Record<string, string>,
      body,
    });
    return JSON.parse(new TextDecoder().decode(body)) as T;
  }

  /**
   * The raw bytes of a request whose body nothing has read yet.
   */
  protected async readBody(
    request: Pick<ServerRequest, "raw">,
  ): Promise<Uint8Array> {
    const web = request.raw.web?.req;
    if (web) {
      return new Uint8Array(await web.arrayBuffer());
    }
    const node = request.raw.node?.req;
    if (node) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of node as AsyncIterable<Uint8Array | string>) {
        const bytes =
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        chunks.push(bytes);
        size += bytes.byteLength;
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return body;
    }
    return new Uint8Array();
  }

  protected header(
    headers: WebhookVerifyOptions["headers"],
    name: string,
  ): string | undefined {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const record = headers as Record<string, string | string[] | undefined>;
    const key = Object.keys(record).find((it) => it.toLowerCase() === name);
    const value = key ? record[key] : undefined;
    return Array.isArray(value) ? value[0] : value;
  }
}

/**
 * The body of a Standard Webhooks request as an Alepha sender writes it.
 */
export interface WebhookReceivedEnvelope<T = Record<string, unknown>> {
  id: string;
  type: string;
  timestamp: string;
  data: T;
}
