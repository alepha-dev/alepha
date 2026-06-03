import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $route, HttpError } from "alepha/server";
import { BeaconIngestService } from "../services/BeaconIngestService.ts";
import { BlightIngestService } from "../services/BlightIngestService.ts";
import { SigilIngestSupport } from "../services/SigilIngestSupport.ts";
import { SigilService } from "../services/SigilService.ts";
import { VitalsIngestService } from "../services/VitalsIngestService.ts";

/**
 * Body schema for `POST /sigils/:id/ingest`.
 *
 * All three capability buckets are optional: a partner server sends only
 * what it has. `country` and `visitor` are stamped by the partner and apply
 * to the whole batch (the partner already resolved country and computed the
 * daily visitor hash server-side).
 *
 * Length constraints mirror the `@alepha/sigil` schemas but are declared
 * locally to avoid importing from `@alepha/sigil` (that barrel pulls React).
 */
const sigilIngestBodySchema = t.object({
  /**
   * Pageview hits. Each item carries the path the user visited.
   * The `beacon` capability gate must pass for these to be recorded.
   */
  views: t.optional(
    t.array(
      t.object({
        path: t.string({ maxLength: 5_000 }),
      }),
      { maxItems: 50 },
    ),
  ),
  /**
   * Crash / error events. Each item carries name, message, stack, and
   * optional sourceUrl. The `blights` capability gate must pass.
   */
  errors: t.optional(
    t.array(
      t.object({
        name: t.optional(t.string({ maxLength: 500 })),
        message: t.optional(t.string({ maxLength: 5_000 })),
        stack: t.optional(t.string({ maxLength: 20_000 })),
        sourceUrl: t.optional(t.string({ maxLength: 5_000 })),
        origin: t.optional(t.enum(["client", "server"], { mode: "text" })),
      }),
      { maxItems: 20 },
    ),
  ),
  /**
   * Web-Vitals samples. Each item carries path, metric name, and raw value.
   * The `vitals` capability gate must pass.
   */
  vitals: t.optional(
    t.array(
      t.object({
        path: t.string({ maxLength: 5_000 }),
        metric: t.string({ maxLength: 50 }),
        value: t.number(),
      }),
      { maxItems: 100 },
    ),
  ),
  /**
   * ISO 3166-1 alpha-2 country code stamped by the partner server (e.g.
   * from `cf-ipcountry`, GeoIP, or a CDN header). Defaults to `"ZZ"` when
   * absent. Applied to all views in the batch.
   */
  country: t.optional(t.string({ maxLength: 8 })),
  /**
   * Partner-computed daily visitor hash. When present it is stored as-is as
   * `sessionHash` in `sigil_unique_visitors` (the partner already derived
   * the day-scoped hash from the visitor's IP + UA). When absent, the
   * unique-visitor insert is skipped.
   */
  visitor: t.optional(t.string({ maxLength: 256 })),
});

/**
 * UUID-keyed, server-to-server ingest endpoint: `POST /sigils/:id/ingest`.
 *
 * This endpoint is the **trusted partner-server** surface — the counterpart
 * to the browser-embed endpoints (`POST /sigils/:id/beacon`,
 * `POST /sigils/:id/blights`). It accepts a single batched payload covering
 * all three capabilities (views, errors, vitals) in one round-trip.
 *
 * **Security model:** the sigil UUID is the ONLY credential. There is no
 * `ingestKey`, no `Origin` allow-list, no UA filter, no CORS — this endpoint
 * is called server-to-server (the sigil UUID is a server-held secret).
 * Gating is:
 *
 * 1. Sigil resolves from `:id` — 404 if missing.
 * 2. Campaign `features.sigils` master toggle — 403 if off.
 * 3. Per-capability: `features.beacon` + `kinds.includes("beacon")` for
 *    views; `features.blights` + `kinds.includes("blights")` for errors;
 *    `features.vitals` + `kinds.includes("vitals")` for vitals.
 *
 * On success the handler returns 204 (no content) — the partner is
 * fire-and-forget, same as the embed endpoints.
 *
 * `$route` (not `$action`) — lives at the ROOT path, not under `/api`,
 * exactly like `VersionController`.
 */
export class SigilIngestController {
  protected log = $logger();
  protected sigils = $inject(SigilService);
  protected beacons = $inject(BeaconIngestService);
  protected blights = $inject(BlightIngestService);
  protected vitals = $inject(VitalsIngestService);
  protected support = $inject(SigilIngestSupport);

  /**
   * `POST /sigils/:id/ingest` — batched, trusted server-to-server ingest.
   *
   * Resolves the sigil, runs the master gate and per-capability gates, then
   * dispatches each capability bucket to its dedicated ingest service.
   * Returns 204 regardless of per-item outcome — the partner is
   * fire-and-forget.
   */
  ingest = $route({
    method: "POST",
    path: "/sigils/:id/ingest",
    schema: {
      params: t.object({ id: t.string() }),
      body: sigilIngestBodySchema,
    },
    handler: async (request) => {
      const { params, body, reply } = request;

      // Gate 1 — sigil resolves.
      const sigil = await this.sigils.findForEmbed(params.id);
      if (!sigil) {
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }

      const kinds: string[] = sigil.kinds ?? [];

      // Gate 2 — master toggle: features.sigils must be ON.
      const sigilsOn = await this.support.isFeatureOn(
        sigil.campaignId,
        "sigils",
      );
      if (!sigilsOn) {
        reply.setStatus(403);
        return;
      }

      // Gate 3a — views: features.beacon + kinds.includes("beacon").
      if (body.views && body.views.length > 0) {
        const beaconOn = await this.support.isFeatureOn(
          sigil.campaignId,
          "beacon",
        );
        if (beaconOn && kinds.includes("beacon")) {
          for (const view of body.views) {
            try {
              await this.beacons.ingestView(
                sigil.id,
                view.path,
                body.country,
                body.visitor,
              );
            } catch (err) {
              this.log.warn("Ingest view failed", err);
            }
          }
        }
      }

      // Gate 3b — errors: features.blights + kinds.includes("blights").
      if (body.errors && body.errors.length > 0) {
        const blightsOn = await this.support.isFeatureOn(
          sigil.campaignId,
          "blights",
        );
        if (blightsOn && kinds.includes("blights")) {
          for (const error of body.errors) {
            try {
              await this.blights.ingestEventTrusted(sigil.id, error);
            } catch (err) {
              this.log.warn("Ingest error failed", err);
            }
          }
        }
      }

      // Gate 3c — vitals: features.vitals + kinds.includes("vitals").
      if (body.vitals && body.vitals.length > 0) {
        const vitalsOn = await this.support.isFeatureOn(
          sigil.campaignId,
          "vitals",
        );
        if (vitalsOn && kinds.includes("vitals")) {
          try {
            // body.vitals metric is `string` here (schema can't know the
            // VitalMetric enum without importing @alepha/sigil which pulls
            // React). VitalsIngestService silently drops unknown metrics, so
            // the cast is safe — invalid values are filtered inside the service.
            // biome-ignore lint/suspicious/noExplicitAny: see above
            await this.vitals.ingestVitals(sigil.id, body.vitals as any);
          } catch (err) {
            this.log.warn("Ingest vitals failed", err);
          }
        }
      }

      reply.setStatus(204);
    },
  });

  /**
   * `GET /sigils/:id/campaign` — public sigil → campaign resolver.
   *
   * Maps a sigil UUID to the campaign it belongs to so the first-party
   * petition request page (driven off an external "report a bug" link that
   * only carries the sigil id) can redirect the visitor to
   * `/c/:campaignId/request`. Public + unauthenticated — the sigil UUID is
   * the sole credential, exactly like the ingest endpoint.
   *
   * Resolution mirrors the ingest path: `SigilService.findForEmbed(:id)` →
   * 404 with the same message when the sigil cannot be resolved.
   *
   * `$route` (not `$action`) — lives at the ROOT path, not under `/api`.
   */
  getSigilCampaign = $route({
    method: "GET",
    path: "/sigils/:id/campaign",
    schema: {
      params: t.object({ id: t.string() }),
      response: t.object({ campaignId: t.integer() }),
    },
    handler: async ({ params }) => {
      const sigil = await this.sigils.findForEmbed(params.id);
      if (!sigil) {
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }
      return { campaignId: sigil.campaignId };
    },
  });
}
