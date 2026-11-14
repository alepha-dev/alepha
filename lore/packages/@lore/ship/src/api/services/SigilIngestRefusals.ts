import { SIGIL_INGEST_PATH } from "@alepha/lore/sigil";
import { $hook } from "alepha";
import { $logger } from "alepha/logger";
import { HttpError } from "alepha/server";

/**
 * The sigil sink's refusal log, apart from `SigilIngestController` so that
 * the controller holds no `$hook` and is created on its first request
 * (#Q3404). A hook acts at boot, whatever class declares it.
 */
export class SigilIngestRefusals {
  protected readonly log = $logger();

  /**
   * A batch this sink refused, said at `warn` with the reason.
   *
   * The server logs a 4xx at `debug`, which production does not ship, and the
   * sender's proxy is fail-open by design: so a sender whose payload stopped
   * matching `sigilForwarded` loses all its telemetry while both sides look
   * healthy. That happened for a day in October 2026, when `@alepha/lore`
   * 0.32.0 ran on a framework whose `crypto.hash` had become async and
   * forwarded an unawaited `visitor` as `{}` (#Q2683). The message names the
   * field (`... (/visitor)`), which is the whole diagnosis.
   *
   * Never 401: an unknown token is anyone with the URL, and its reason is
   * deliberately the same for every case (see {@link resolve}). The body is
   * never logged, only the reason.
   */
  protected readonly onRefused = $hook({
    on: "server:request:error",
    handler: ({ route, error }) => {
      if (route?.path !== SIGIL_INGEST_PATH) return;
      if (!(error instanceof HttpError)) return;
      if (error.status < 400 || error.status >= 500 || error.status === 401) {
        return;
      }
      this.log.warn(`Sigil batch refused (${error.status}): ${error.message}`);
    },
  });
}
