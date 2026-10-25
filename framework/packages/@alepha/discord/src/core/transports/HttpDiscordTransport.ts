import { $inject, AlephaError } from "alepha";
import { HttpClient, isHttpError } from "alepha/server";

import {
  DiscordTransport,
  type DiscordWebhookPayload,
} from "./DiscordTransport.ts";

/**
 * The real transport: one POST, through the framework's own http client.
 *
 * `fetch` and nothing else, so the package is workerd-safe. Lore runs on
 * Cloudflare, where a node builtin anywhere in this graph is an empty module
 * at runtime rather than a build error.
 *
 * ⚠️ `HttpClient` logs the request url at DEBUG (`"Response"`), so running an
 * app at `LOG_LEVEL=debug` puts the webhook url in its logs. Everything this
 * package writes itself names the destination instead.
 */
export class HttpDiscordTransport extends DiscordTransport {
  protected readonly http = $inject(HttpClient);

  public async post(
    webhook: string,
    payload: DiscordWebhookPayload,
  ): Promise<void> {
    try {
      // A webhook POST answers 204 with no body, which `HttpClient` returns
      // as undefined rather than trying to parse. Anything from 400 up
      // throws, which is exactly the reporting this needs.
      await this.http.fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      // ⚠️ Re-thrown without the url. It is the whole credential: anyone
      // holding it can post as this app, and an error message ends up in a
      // log line, in a delivery receipt's `error` column, and on an admin
      // page. The status is what an operator actually needs.
      //
      // `Retry-After` is deliberately not read. `HttpClient` throws before
      // returning a response, so the header is out of reach here, and the
      // notification job already owns the retry schedule: honouring it would
      // mean a second backoff multiplying the first.
      const status = isHttpError(error) ? error.status : undefined;
      throw new AlephaError(
        `Discord refused the message${status ? ` with HTTP ${status}` : ""}. ` +
          "The notification job will retry it.",
        { cause: error },
      );
    }
  }
}
