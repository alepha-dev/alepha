import { $env, $hook, $inject, Alepha, t } from "alepha";
import { $logger } from "alepha/logger";
import { HttpClient } from "alepha/server";
import { sigilEnv } from "../sigilEnv.ts";

const DEFAULT_LORE = "https://lore.alepha.dev";

export class SigilForwardProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);
  protected readonly log = $logger();
  protected config?: { id: string; loreOrigin: string };

  /**
   * Lazily-resolved sigil → campaign mapping plus the sigil's `excludedPaths`.
   * Both come from a single `GET /sigils/:id/campaign` lookup and are cached
   * after the first success so {@link campaignId} / {@link excludedPaths} only
   * hit Lore once.
   */
  protected cachedCampaignId?: number;
  protected cachedExcludedPaths?: string[];

  protected env = $env(sigilEnv);

  protected readonly init = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isBrowser()) return;
      const { SIGIL_ID, LORE_URL } = this.env;

      if (!this.alepha.isProduction()) return;

      if (!SIGIL_ID) {
        this.log.warn(
          "[sigil] SIGIL_ID not set — Sigil telemetry disabled in production.",
        );
        return;
      }

      this.config = {
        id: SIGIL_ID,
        loreOrigin: (LORE_URL ?? DEFAULT_LORE).replace(/\/$/, ""),
      };
    },
  });

  public enabled(): boolean {
    return !!this.config;
  }

  public id(): string | undefined {
    return this.config?.id;
  }

  public loreOrigin(): string | undefined {
    return this.config?.loreOrigin;
  }

  /**
   * Resolve the campaign id for the configured sigil. Backed by the shared
   * {@link resolve} lookup, cached after the first success.
   *
   * Returns `undefined` when the provider is disabled or the lookup fails —
   * the sigil id (a server-only secret) is never exposed to the browser.
   */
  public async campaignId(): Promise<number | undefined> {
    await this.resolve();
    return this.cachedCampaignId;
  }

  /**
   * The configured sigil's `excludedPaths` — the glob patterns on which the
   * embed (e.g. the petition button) is suppressed. Backed by the same shared
   * {@link resolve} lookup as {@link campaignId}, so reading both only hits
   * Lore once. Returns `[]` when the provider is disabled or the lookup fails.
   */
  public async excludedPaths(): Promise<string[]> {
    await this.resolve();
    return this.cachedExcludedPaths ?? [];
  }

  /**
   * One-shot resolution of the sigil → `{ campaignId, excludedPaths }` mapping
   * via Lore's `GET {loreOrigin}/sigils/:id/campaign` endpoint. No-op when the
   * provider is disabled or the values are already cached, so the lookup fires
   * at most once regardless of how many accessors call it.
   */
  protected async resolve(): Promise<void> {
    if (!this.config) return;
    if (this.cachedCampaignId !== undefined) return;

    try {
      const res = await this.http.fetch(this.url("campaign"), {
        method: "GET",
        schema: {
          response: t.object({
            campaignId: t.integer(),
            excludedPaths: t.optional(t.array(t.string())),
          }),
        },
      });
      this.cachedCampaignId = res.data.campaignId;
      this.cachedExcludedPaths = res.data.excludedPaths ?? [];
    } catch (error) {
      this.log.warn(
        `[sigil] campaign resolution failed for ${this.url("campaign")}`,
        error,
      );
    }
  }

  protected url(suffix: string): string {
    const c = this.config!;
    return `${c.loreOrigin}/sigils/${encodeURIComponent(c.id)}/${suffix}`;
  }

  public async forwardIngest(
    envelope: Record<string, any>,
    stamp: { country?: string; visitor?: string },
  ): Promise<void> {
    if (!this.config) return;

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
