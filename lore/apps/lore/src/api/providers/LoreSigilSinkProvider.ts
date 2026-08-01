import type { SigilConfig } from "@alepha/sigil/config";
import type { SigilEnvelope } from "@alepha/sigil/envelope";
import { SigilSinkProvider } from "@alepha/sigil/server";
import { $inject, AlephaError } from "alepha";
import type { Sigil } from "../entities/sigils.ts";
import { SigilIngestService } from "../services/SigilIngestService.ts";
import { SigilTokenService } from "../services/SigilTokenService.ts";

/**
 * Lore reporting to Lore, without the network.
 *
 * Lore is the sink, so the ordinary path — POST to `SIGIL_SINK` — would have
 * the Worker fetch its own hostname. Cloudflare refuses that subrequest, and
 * both call sites in {@link SigilSinkProvider} are fail-open by design, so the
 * refusal surfaces nowhere: config falls back to "collect everything", flushes
 * are swallowed by a `log.warn`, and Lore looks enrolled while reporting
 * nothing. That is why the previous attempt at dogfooding was removed rather
 * than fixed.
 *
 * Substituted for the base provider in `main.server.ts`. It overrides the two
 * transport methods and nothing else: aggregation, the flush window, the caps
 * and the fail-open handling stay in the base class, so the in-process path
 * cannot quietly start behaving differently from the one every other app uses.
 *
 * The credential is not skipped. `SIGIL_KEY` still names a real sigil row and
 * is still resolved through {@link SigilTokenService.verify} — rotation and
 * deletion revoke Lore's own reporting exactly as they would a partner's. What
 * is skipped is the HTTP hop, not the authentication.
 */
export class LoreSigilSinkProvider extends SigilSinkProvider {
  protected readonly tokens = $inject(SigilTokenService);
  protected readonly ingestService = $inject(SigilIngestService);

  protected override async fetchConfig(): Promise<SigilConfig> {
    return await this.ingestService.configFor(await this.ownSigil());
  }

  protected override async deliver(
    payload: SigilEnvelope & { country?: string; visitor?: string },
  ): Promise<void> {
    await this.ingestService.absorb(await this.ownSigil(), payload);
  }

  /**
   * The sigil `SIGIL_KEY` names, or a throw.
   *
   * Throwing rather than returning `undefined` is what keeps this honest: both
   * callers already treat a failure as "keep the last known appetite" and log
   * it. Returning a silent no-op instead would reproduce the exact failure this
   * class exists to remove — an app that reports nothing and says nothing.
   *
   * Not cached. A token is rotated by replacing the hash, and a row deleted by
   * removing it; a cached sigil would keep a revoked credential working until
   * the next deploy, which is the opposite of what rotation is for. The lookup
   * is one indexed read per flush, against a batch that already waited ten
   * seconds.
   */
  protected async ownSigil(): Promise<Sigil> {
    const sigil = await this.tokens.verify(this.env.SIGIL_KEY);
    if (!sigil) {
      throw new AlephaError(
        "SIGIL_KEY does not match any sigil in this instance — Lore cannot report to itself",
      );
    }
    return sigil;
  }
}
