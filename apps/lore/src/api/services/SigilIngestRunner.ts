import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { SigilIngestBody } from "../schemas/sigilIngestBody.ts";
import { BeaconIngestService } from "./BeaconIngestService.ts";
import { BlightIngestService } from "./BlightIngestService.ts";
import { SigilIngestSupport } from "./SigilIngestSupport.ts";
import { SigilService } from "./SigilService.ts";
import { VitalsIngestService } from "./VitalsIngestService.ts";

/**
 * Outcome of an ingest batch.
 *
 * - `ok` — sigil resolved, master toggle on, capability buckets dispatched.
 * - `not-found` — the sigil id did not resolve.
 * - `feature-off` — the sigil resolved but `features.sigils` is off.
 *
 * The HTTP `$route` maps these to 204 / 404 / 403; the in-process caller
 * (telemetry forward) only logs a non-`ok` outcome.
 */
export type SigilIngestOutcome = "ok" | "not-found" | "feature-off";

/**
 * Shared sigil telemetry ingest pipeline.
 *
 * Resolves the sigil, runs the master gate and per-capability gates, then
 * dispatches each capability bucket (views / errors / vitals) to its dedicated
 * ingest service. Per-item failures are logged and swallowed — the batch is
 * best-effort, mirroring the fire-and-forget contract of the embed endpoints.
 *
 * Both entry points share this so the gating logic lives in exactly one place:
 * - {@link SigilIngestController} — the trusted server-to-server `$route`.
 * - `LoreSigilForwardProvider` — the in-process path used when Lore dogfoods
 *   its own sigil (a Cloudflare Worker cannot fetch its own hostname, so the
 *   HTTP self-call in the base `SigilForwardProvider` is bypassed).
 */
export class SigilIngestRunner {
  protected log = $logger();
  protected sigils = $inject(SigilService);
  protected beacons = $inject(BeaconIngestService);
  protected blights = $inject(BlightIngestService);
  protected vitals = $inject(VitalsIngestService);
  protected support = $inject(SigilIngestSupport);

  /**
   * Run a telemetry batch for the sigil identified by `sigilId`.
   */
  public async run(
    sigilId: string,
    body: SigilIngestBody,
  ): Promise<SigilIngestOutcome> {
    // Gate 1 — sigil resolves.
    const sigil = await this.sigils.findForEmbed(sigilId);
    if (!sigil) {
      return "not-found";
    }

    const kinds: string[] = sigil.kinds ?? [];

    // Gate 2 — master toggle: features.sigils must be ON.
    const sigilsOn = await this.support.isFeatureOn(sigil.campaignId, "sigils");
    if (!sigilsOn) {
      return "feature-off";
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
          // body.vitals metric is `string` here (the schema can't know the
          // VitalMetric enum without importing @alepha/sigil which pulls
          // React). VitalsIngestService silently drops unknown metrics, so the
          // cast is safe — invalid values are filtered inside the service.
          // biome-ignore lint/suspicious/noExplicitAny: see above
          await this.vitals.ingestVitals(sigil.id, body.vitals as any);
        } catch (err) {
          this.log.warn("Ingest vitals failed", err);
        }
      }
    }

    return "ok";
  }
}
