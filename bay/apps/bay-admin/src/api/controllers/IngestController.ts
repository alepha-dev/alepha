import { pulseConfig } from "@alepha/pulse-client/config";
import { pulseEnvelope } from "@alepha/pulse-client/envelope";
import { $inject, z } from "alepha";
import { $logger } from "alepha/logger";
import { $action, HttpError } from "alepha/server";
import { AppKeyService } from "../services/AppKeyService.ts";
import { IngestService } from "../services/IngestService.ts";

/**
 * Where enrolled apps report, and where they ask how much to report.
 *
 * **A separate realm from everything else in Pulse, in both directions.** These
 * two endpoints accept an app's ingest key and nothing else — an authenticated
 * admin session is not enough to post telemetry, and an ingest key opens
 * nothing but these two routes.
 *
 * The asymmetry matters more than it looks. An ingest key exists in cleartext
 * on every machine that runs the app it belongs to; treating it as an
 * authentication of any kind would hand out Pulse's control surface with it.
 * Conversely, accepting the admin session here would mean a logged-in operator
 * browsing a malicious page could be made to write into someone's telemetry.
 *
 * Hence `$secure` is deliberately absent: these are not "public" endpoints,
 * they are endpoints with their own credential, resolved by hand below.
 */
export class IngestController {
  protected readonly log = $logger();
  protected readonly keys = $inject(AppKeyService);
  protected readonly ingest = $inject(IngestService);

  /**
   * `POST /api/ingest` — one telemetry batch.
   *
   * Answers what it accepted, per section. The result is shown rather than
   * inferred: an app whose vitals are being dropped by a kill-switch should be
   * able to see that from the response, not deduce it from an empty chart.
   */
  push = $action({
    method: "POST",
    path: "/ingest",
    description: "Telemetry intake for an enrolled app (bearer = ingest key)",
    schema: {
      body: pulseEnvelope.extend({
        country: z.string().max(8).optional(),
        visitor: z.string().max(128).optional(),
      }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.object({
        accepted: z.record(z.string(), z.number()),
      }),
    },
    handler: async ({ body, headers }) => {
      const app = await this.resolve(headers.authorization);
      return await this.ingest.absorb(app, body);
    },
  });

  /**
   * `GET /api/ingest/config` — how much this app should send.
   *
   * Per app, so one noisy app can be turned down without touching the others.
   * Answered from the app's stored appetite, with the sink's defaults filling
   * the gaps.
   */
  config = $action({
    method: "GET",
    path: "/ingest/config",
    description: "What the sink currently wants from this app",
    schema: {
      headers: z.object({ authorization: z.string().optional() }),
      response: pulseConfig,
    },
    handler: async ({ headers }) => {
      const app = await this.resolve(headers.authorization);
      const appetite = (app.appetite ?? {}) as Record<string, unknown>;
      return {
        ...appetite,
        // The petition URL lives on the app row rather than in the appetite
        // blob: it is a setting an operator toggles, not a rate they tune.
        ...(app.petitionUrl ? { petitionUrl: app.petitionUrl } : {}),
      };
    },
  });

  /**
   * Turns a bearer header into an app, or refuses.
   *
   * 401 for missing, unknown and revoked alike. Distinguishing them would let
   * anyone with a URL discover whether a key ever existed.
   */
  protected async resolve(authorization: string | undefined) {
    const app = await this.keys.resolve(this.keys.bearer(authorization));
    if (!app) {
      throw new HttpError({
        status: 401,
        message: "Unknown or revoked ingest key",
      });
    }
    return app;
  }
}
