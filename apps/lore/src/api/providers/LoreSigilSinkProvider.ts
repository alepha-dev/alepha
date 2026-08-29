import type { SigilForwarded, SigilStamp } from "@alepha/sigil";
import { SigilSinkProvider } from "@alepha/sigil";
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
  /*
   * There was a `fetchConfig` override here too, for the second self-subrequest
   * — the GET that asked the sink how much to send. The base class no longer
   * asks: an app reads its own `SIGIL_CONFIG`, so Lore reads one like everybody
   * else and only the write path still needs routing in process.
   */
  protected readonly tokens = $inject(SigilTokenService);
  protected readonly ingestService = $inject(SigilIngestService);

  /**
   * `SigilStamp` rather than the two fields spelled out, which is what this
   * used to take. The stamp is the base class's own definition of what a
   * flush carries, and restating a subset of it here meant every field added
   * upstream — `device`, then `host` — arrived at `absorb` untyped and
   * unnoticed. Naming the type is what keeps the in-process path from drifting
   * away from the networked one it exists to imitate.
   *
   * `SigilForwarded` rather than `SigilEnvelope` for the same reason, one
   * level up: the envelope grew fields the app's own server fills in, and
   * `config` is one of them. It also matters that this path skips the ingest
   * endpoint's body validation entirely - nothing between here and `absorb`
   * checks a shape - which is what makes the second normalization inside
   * `absorb` load-bearing rather than defence in depth.
   */
  protected override async deliver(
    payload: SigilForwarded & SigilStamp,
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
