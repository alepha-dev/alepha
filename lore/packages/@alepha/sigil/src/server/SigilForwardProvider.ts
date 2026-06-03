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
   * Lazily-resolved campaign id for the configured sigil. Cached after the
   * first successful lookup so {@link campaignId} only hits Lore once.
   */
  protected cachedCampaignId?: number;

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
   * Resolve the campaign id for the configured sigil by calling Lore's
   * `GET {loreOrigin}/sigils/:id/campaign` endpoint. The result is cached
   * after the first successful lookup so subsequent calls do not refetch.
   *
   * Returns `undefined` when the provider is disabled or the lookup fails —
   * the sigil id (a server-only secret) is never exposed to the browser.
   */
  public async campaignId(): Promise<number | undefined> {
    if (!this.config) return undefined;
    if (this.cachedCampaignId !== undefined) return this.cachedCampaignId;

    try {
      const res = await this.http.fetch(this.url("campaign"), {
        method: "GET",
        schema: { response: t.object({ campaignId: t.integer() }) },
      });
      this.cachedCampaignId = res.data.campaignId;
      return this.cachedCampaignId;
    } catch {
      return undefined;
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
      .catch(() => {});
  }
}
