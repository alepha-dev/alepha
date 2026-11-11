import { $inject, Alepha, AlephaError } from "alepha";

import {
  WebhookTransport,
  type WebhookTransportRequest,
  type WebhookTransportResponse,
} from "./WebhookTransport.ts";

/**
 * The default transport: one `POST` through `fetch`.
 *
 * Not `HttpClient.fetch`, which throws on any status from 400 after reading
 * the whole body, rebuilds error classes from a JSON body, and logs the full
 * URL. Here:
 *
 * - no redirect is followed (`redirect: "manual"`): a 3xx is an answer, and
 *   a failed attempt;
 * - the run's ambient signal (`alepha.context.signal`) composed with a
 *   15 second timeout, so a cancelled job or a hung receiver stops the
 *   request;
 * - the response body is read up to 2 KB, then cancelled, so a receiver that
 *   streams forever cannot hold the run;
 * - a network error names the host, never the URL.
 */
export class HttpWebhookTransport extends WebhookTransport {
  protected readonly alepha = $inject(Alepha);

  /**
   * How long a receiver has to answer.
   */
  public timeoutMs = 15_000;

  /**
   * How much of the answer is kept.
   */
  public excerptBytes = 2048;

  public async send(
    request: WebhookTransportRequest,
  ): Promise<WebhookTransportResponse> {
    const started = performance.now();
    let response: Response;
    try {
      response = await this.request(request.url, {
        method: "POST",
        redirect: "manual",
        headers: request.headers,
        body: request.body,
        signal: this.signal(),
      });
    } catch (error) {
      throw new AlephaError(
        `Webhook request to ${this.hostOf(request.url)} failed: ${this.reason(error)}`,
      );
    }
    const bodyExcerpt = await this.readExcerpt(response);
    return {
      status: response.status,
      bodyExcerpt,
      durationMs: Math.round(performance.now() - started),
    };
  }

  /**
   * The network call itself. A spec substitutes this to observe the
   * request `fetch` would make.
   */
  protected request(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }

  protected signal(): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const ambient = this.alepha.context.signal;
    return ambient ? AbortSignal.any([ambient, timeout]) : timeout;
  }

  /**
   * The first {@link excerptBytes} of the body as text, then the stream is
   * cancelled. A body that fails mid-read keeps what arrived.
   */
  protected async readExcerpt(response: Response): Promise<string> {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (size < this.excerptBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
    } catch {
      // A body that breaks mid-read is still an answer: keep what arrived.
    } finally {
      await reader.cancel().catch(() => {});
    }
    const body = new Uint8Array(Math.min(size, this.excerptBytes));
    let offset = 0;
    for (const chunk of chunks) {
      const take = Math.min(chunk.byteLength, body.byteLength - offset);
      if (take <= 0) break;
      body.set(chunk.subarray(0, take), offset);
      offset += take;
    }
    return new TextDecoder().decode(body);
  }

  protected hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  }

  protected reason(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === "TimeoutError") return "timed out";
      if (error.name === "AbortError") return "aborted";
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof Error && cause.message) {
        return this.scrub(cause.message);
      }
      return this.scrub(error.message);
    }
    return "network error";
  }

  /**
   * A runtime's error message can quote the URL; strip anything URL-shaped.
   */
  protected scrub(message: string): string {
    return message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 300);
  }
}
