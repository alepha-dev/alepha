/**
 * One webhook request, signed and serialised: the transport sends `body`
 * byte for byte.
 */
export interface WebhookTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * What the receiver answered.
 */
export interface WebhookTransportResponse {
  status: number;
  /**
   * The first 2 KB of the response body, as text. Never trusted, never
   * parsed: kept for the delivery log.
   */
  bodyExcerpt: string;
  durationMs: number;
}

/**
 * Sends a webhook request. The delivery job never calls `fetch` itself, so
 * a spec substitutes the transport (`MemoryWebhookTransport`) and a
 * deployment can replace it.
 *
 * `send` resolves with any HTTP answer, a 5xx included, and rejects only
 * when no answer came: a network error, a timeout, an aborted run. Its
 * errors never carry the URL, which can hold a token: the host only.
 */
export abstract class WebhookTransport {
  public abstract send(
    request: WebhookTransportRequest,
  ): Promise<WebhookTransportResponse>;
}
