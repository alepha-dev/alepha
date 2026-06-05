import { SigilForwardProvider } from "@alepha/sigil/server";
import { $inject } from "alepha";
import type { SigilIngestBody } from "../schemas/sigilIngestBody.ts";
import { SigilIngestRunner } from "../services/SigilIngestRunner.ts";
import { SigilService } from "../services/SigilService.ts";

/**
 * In-process forward provider for Lore's own (dogfooded) sigil.
 *
 * The base {@link SigilForwardProvider} resolves the campaign and forwards
 * telemetry over HTTP to `{loreOrigin}/sigils/:id/*`. That is correct for a
 * real external partner, but Lore IS the receiver — so on Cloudflare those
 * calls are Worker self-subrequests (the Worker fetching its own hostname),
 * which fail. The petition launcher then never resolved its campaign and the
 * `/sigil/request` proxy 404'd; telemetry was silently dropped.
 *
 * This override keeps the rest of the secret-UUID proxy model intact (the
 * sigil id never reaches the browser) but answers both delivery methods
 * **in-process** against Lore's own services — no HTTP, no self-call. Bound in
 * `main.server.ts` via `alepha.with({ provide: SigilForwardProvider, use: ... })`.
 */
export class LoreSigilForwardProvider extends SigilForwardProvider {
  protected sigils = $inject(SigilService);
  protected runner = $inject(SigilIngestRunner);

  /**
   * Resolve the configured sigil → campaign directly from the DB, skipping
   * the base class's HTTP round-trip to Lore's own hostname.
   */
  public override async campaignId(): Promise<number | undefined> {
    if (!this.enabled()) return undefined;
    const id = this.id();
    if (!id) return undefined;

    const sigil = await this.sigils.findForIngest(id);
    return sigil?.campaignId;
  }

  /**
   * Run the telemetry batch in-process through the shared ingest pipeline
   * instead of POSTing it back to Lore over HTTP.
   */
  public override async forwardIngest(
    envelope: Record<string, any>,
    stamp: { country?: string; visitor?: string },
  ): Promise<void> {
    if (!this.enabled()) return;
    const id = this.id();
    if (!id) return;

    const outcome = await this.runner.run(id, {
      ...envelope,
      ...stamp,
    } as SigilIngestBody);

    if (outcome !== "ok") {
      this.log.warn(`[sigil] in-process ingest skipped: ${outcome}`);
    }
  }
}
