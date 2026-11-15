import { AlephaError } from "alepha";

import {
  DiscordTransport,
  type DiscordWebhookPayload,
} from "./DiscordTransport.ts";

/**
 * Posts to a Discord incoming webhook over HTTP.
 *
 * ⚠️ **The webhook url is the whole credential**: anyone holding it can post
 * as this app. So this transport goes around `HttpClient`, which logs a
 * request's url at debug level, emits it on `client:fetch:before` and keeps
 * it in the `HttpError` it throws. Here the url is handed to `fetch` and to
 * nothing else: no log line, no event, and a refusal carries the status
 * alone, with no `cause` holding the request.
 *
 * `Retry-After` is deliberately not read: the notification job already owns
 * the retry schedule, and honouring it would mean a second backoff
 * multiplying the first.
 */
export class HttpDiscordTransport extends DiscordTransport {
  public async post(
    webhook: string,
    payload: DiscordWebhookPayload,
  ): Promise<void> {
    let status: number | undefined;
    try {
      const response = await this.request(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      // A webhook POST answers 204 with no body; anything from 400 up is a
      // refusal.
      if (response.ok) return;
      status = response.status;
    } catch {
      // A network failure: nothing safe to quote.
    }
    throw new AlephaError(
      `Discord refused the message${status ? ` with HTTP ${status}` : ""}. ` +
        "The notification job will retry it.",
    );
  }

  /**
   * The one place the url goes. A method, so a spec can replace it.
   */
  protected request(url: string, init: RequestInit): Promise<Response> {
    return globalThis.fetch(url, init);
  }
}
