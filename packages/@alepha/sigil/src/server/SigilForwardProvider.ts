import { $env, $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { HttpClient } from "alepha/server";
import { sigilEnv } from "../sigilEnv.ts";

const DEFAULT_LORE = "https://lore.alepha.dev";

export class SigilForwardProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);
  protected readonly log = $logger();
  protected config?: { id: string; loreOrigin: string };

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

  public async forwardPetition(form: FormData): Promise<void> {
    if (!this.config) return;

    await this.http
      .fetch(this.url("petition"), { method: "POST", body: form })
      .catch(() => {});
  }
}
