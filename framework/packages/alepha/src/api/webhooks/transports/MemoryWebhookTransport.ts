import { AlephaError } from "alepha";

import type { WebhookEnvelope } from "../schemas/webhookEnvelopeSchema.ts";
import {
  WebhookTransport,
  type WebhookTransportRequest,
  type WebhookTransportResponse,
} from "./WebhookTransport.ts";

/**
 * A scripted answer for {@link MemoryWebhookTransport}.
 */
export interface MemoryWebhookResponse {
  status: number;
  body?: string;
  /**
   * How long the "receiver" takes to answer. Past the transport's
   * `timeoutMs`, the send fails as a timeout, as the HTTP transport's does.
   */
  delayMs?: number;
}

/**
 * One request the memory transport took.
 */
export interface MemoryWebhookRequest {
  url: string;
  headers: Record<string, string>;
  /**
   * The raw body, byte for byte what was signed.
   */
  body: string;
  envelope: WebhookEnvelope;
  /**
   * The answer it got: a status, or `network` when it failed with none.
   */
  outcome: number | "network";
}

/**
 * The webhook transport under test: nothing leaves the process.
 *
 * Substituted by the module when `alepha.isTest()`. It does NOT skip
 * signing: the delivery service signs as always, and the recorded headers
 * are real, so a spec can hand them to `WebhookVerifier` to prove a round
 * trip. A spec that needs real HTTP names `HttpWebhookTransport`.
 *
 * Every endpoint answers 200 `ok` unless scripted. A contract suite holds
 * the HTTP transport to the same answers.
 *
 * @example
 * ```ts
 * const transport = alepha.inject(MemoryWebhookTransport);
 * transport.respondOnce(url, { status: 500 });
 * transport.respondOnce(url, { status: 500 });
 * // third attempt: 200
 * await shop.webhooks.paid.send({ orderId, total });
 * expect(transport.wasDelivered("order.paid", url)).toBe(true);
 * ```
 */
export class MemoryWebhookTransport extends WebhookTransport {
  /**
   * Every request taken, oldest first, failed ones included.
   */
  public readonly requests: MemoryWebhookRequest[] = [];

  /**
   * As the HTTP transport's: a scripted delay past it is a timeout.
   */
  public timeoutMs = 15_000;

  protected readonly standing = new Map<string, MemoryWebhookResponse>();
  protected readonly queued = new Map<string, MemoryWebhookResponse[]>();
  protected readonly unreachable = new Set<string>();

  /**
   * Answer every request to `url` this way, until changed.
   */
  public respond(url: string, response: MemoryWebhookResponse): this {
    this.unreachable.delete(url);
    this.standing.set(url, response);
    return this;
  }

  /**
   * Answer the NEXT request to `url` this way. Queued answers are used in
   * order before the standing one: "fail twice, then 200".
   */
  public respondOnce(url: string, response: MemoryWebhookResponse): this {
    const queue = this.queued.get(url) ?? [];
    queue.push(response);
    this.queued.set(url, queue);
    return this;
  }

  /**
   * Fail every request to `url` with no answer, as an unreachable host
   * does.
   */
  public failNetwork(url: string): this {
    this.unreachable.add(url);
    return this;
  }

  /**
   * Forget every recorded request and script.
   */
  public reset(): void {
    this.requests.length = 0;
    this.standing.clear();
    this.queued.clear();
    this.unreachable.clear();
  }

  /**
   * Whether an event of `eventType` reached (a 2xx) `url`, or any endpoint.
   */
  public wasDelivered(eventType: string, url?: string): boolean {
    return this.requests.some(
      (it) =>
        it.envelope.type === eventType &&
        (url === undefined || it.url === url) &&
        typeof it.outcome === "number" &&
        it.outcome >= 200 &&
        it.outcome < 300,
    );
  }

  /**
   * Every request made to `url`, oldest first.
   */
  public deliveriesFor(url: string): MemoryWebhookRequest[] {
    return this.requests.filter((it) => it.url === url);
  }

  /**
   * The envelope of the latest request carrying `eventType`.
   */
  public lastEnvelope(eventType: string): WebhookEnvelope | undefined {
    return this.requests.findLast((it) => it.envelope.type === eventType)
      ?.envelope;
  }

  public async send(
    request: WebhookTransportRequest,
  ): Promise<WebhookTransportResponse> {
    const record: MemoryWebhookRequest = {
      url: request.url,
      headers: { ...request.headers },
      body: request.body,
      envelope: JSON.parse(request.body) as WebhookEnvelope,
      outcome: "network",
    };
    this.requests.push(record);
    const host = this.hostOf(request.url);

    if (this.unreachable.has(request.url)) {
      throw new AlephaError(
        `Webhook request to ${host} failed: connection refused`,
      );
    }
    const response = this.queued.get(request.url)?.shift() ??
      this.standing.get(request.url) ?? { status: 200, body: "ok" };
    if (response.delayMs) {
      const wait = Math.min(response.delayMs, this.timeoutMs);
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (response.delayMs >= this.timeoutMs) {
        throw new AlephaError(`Webhook request to ${host} failed: timed out`);
      }
    }
    record.outcome = response.status;
    return {
      status: response.status,
      bodyExcerpt: (response.body ?? "").slice(0, 2048),
      durationMs: response.delayMs ?? 0,
    };
  }

  protected hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  }
}
