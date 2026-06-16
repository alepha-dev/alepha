import { $env, $hook, $inject, Alepha, t } from "alepha";
import { $logger } from "alepha/logger";
import { HttpClient } from "alepha/server";
import { sigilClientAtom } from "../shared/sigilClientAtom.ts";
import {
  parseSigilFeatures,
  SIGIL_FEATURES,
  type SigilFeature,
} from "../shared/sigilFeatures.ts";
import { sigilOptions } from "../shared/sigilOptionsAtom.ts";
import { sigilEnv } from "../sigilEnv.ts";

const DEFAULT_LORE = "https://lore.alepha.dev";

/**
 * Server-side owner of the sigil config and the Lore forward path.
 *
 * Config lives in the {@link sigilOptions} atom (app store, never serialized —
 * it holds the secret id). This provider populates it from env at boot, exposes
 * typed accessors, and — per request — publishes the non-secret subset into
 * {@link sigilClientAtom} so SSR delivers it to the browser.
 */
export class SigilForwardProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);
  protected readonly log = $logger();
  protected env = $env(sigilEnv);

  /**
   * Lazily-resolved campaign id for the configured sigil. Cached after the
   * first successful lookup so {@link campaignId} only hits Lore once.
   */
  protected cachedCampaignId?: number;

  /**
   * Merge env config into {@link sigilOptions} at boot. Runs at "start" (no
   * request context) so it lands in the app store and is never serialized.
   * Host-set fields (e.g. `excludedPaths` set in a module `register`) are
   * preserved; env wins for `id` / `loreOrigin` / `features`.
   *
   * Also registers the per-request publisher that copies the non-secret subset
   * into {@link sigilClientAtom} for SSR.
   */
  protected readonly init = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isBrowser()) return;
      if (!this.alepha.isProduction()) return;

      const { SIGIL_ID, LORE_URL, SIGIL_FEATURES: featuresEnv } = this.env;
      const current = this.alepha.store.get(sigilOptions);

      this.alepha.store.set(sigilOptions, {
        ...current,
        ...(SIGIL_ID ? { id: SIGIL_ID } : {}),
        loreOrigin: (LORE_URL ?? current.loreOrigin ?? DEFAULT_LORE).replace(
          /\/$/,
          "",
        ),
        ...(featuresEnv ? { features: parseSigilFeatures(featuresEnv) } : {}),
      });

      if (!this.id()) {
        this.log.warn(
          "[sigil] SIGIL_ID not set — Sigil telemetry disabled in production.",
        );
      }

      // Per request: publish the public subset (features + excludedPaths, never
      // the id) so `exportAtoms("current")` serializes it into the page. Fires
      // before `createHtmlStream`, so the value is captured in the hydration.
      this.alepha.events.on("react:server:render:begin", () => {
        this.alepha.store.set(sigilClientAtom, {
          features: this.features(),
          excludedPaths:
            this.alepha.store.get(sigilOptions).excludedPaths ?? [],
        });
      });
    },
  });

  public enabled(): boolean {
    return !!this.id();
  }

  public id(): string | undefined {
    return this.alepha.store.get(sigilOptions).id;
  }

  public loreOrigin(): string {
    return this.alepha.store.get(sigilOptions).loreOrigin ?? DEFAULT_LORE;
  }

  /**
   * The effective enabled features. `SIGIL_FEATURES` (env) overrides any
   * host-set `sigilOptions.features`; when neither is configured, ALL features
   * are on — the legacy "collect everything" default, with the env acting
   * purely as a filter.
   */
  public features(): SigilFeature[] {
    const configured = this.alepha.store.get(sigilOptions).features;
    if (!configured) {
      return [...SIGIL_FEATURES];
    }
    return SIGIL_FEATURES.filter((feature) => configured.includes(feature));
  }

  /**
   * Resolve the campaign id for the configured sigil by calling Lore's
   * `GET {loreOrigin}/sigils/:id/campaign` endpoint. Cached after the first
   * success. Returns `undefined` when disabled or the lookup fails — the sigil
   * id (a server-only secret) is never exposed to the browser.
   */
  public async campaignId(): Promise<number | undefined> {
    if (!this.enabled()) return undefined;
    if (this.cachedCampaignId !== undefined) return this.cachedCampaignId;

    try {
      const res = await this.http.fetch(this.url("campaign"), {
        method: "GET",
        schema: { response: t.object({ campaignId: t.integer() }) },
      });
      this.cachedCampaignId = res.data.campaignId;
      return this.cachedCampaignId;
    } catch (error) {
      this.log.warn(
        `[sigil] campaign resolution failed for ${this.url("campaign")}`,
        error,
      );
      return undefined;
    }
  }

  protected url(suffix: string): string {
    return `${this.loreOrigin()}/sigils/${encodeURIComponent(this.id() ?? "")}/${suffix}`;
  }

  public async forwardIngest(
    envelope: Record<string, any>,
    stamp: { country?: string; visitor?: string },
  ): Promise<void> {
    if (!this.enabled()) return;

    await this.http
      .fetch(this.url("ingest"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...envelope, ...stamp }),
      })
      .catch((error) =>
        this.log.warn(
          `[sigil] telemetry forward failed for ${this.url("ingest")}`,
          error,
        ),
      );
  }
}
