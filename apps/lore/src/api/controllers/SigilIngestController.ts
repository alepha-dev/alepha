import { sigilForwarded } from "@alepha/lore/sigil";
import { SIGIL_INGEST_PATH } from "@alepha/lore/sigil";
import { $inject, z } from "alepha";
import { $route, UnauthorizedError } from "alepha/server";

import type { Sigil } from "../entities/sigils.ts";
import { SigilIngestService } from "../services/SigilIngestService.ts";
import { SigilTokenService } from "../services/SigilTokenService.ts";

/**
 * Where enrolled apps report, and where they ask how much to report.
 *
 * **A separate realm from everything else in Lore, in both directions.** This
 * endpoint accepts a sigil token and nothing else — an authenticated project
 * member is not enough to report into a project, and a sigil token opens
 * nothing but this route.
 *
 * The asymmetry matters more than it looks. A sigil token exists in cleartext
 * on every machine that runs the app it belongs to; treating it as an
 * authentication of any kind would hand out Lore's project surface with it.
 * Conversely, accepting the session cookie here would mean a logged-in owner
 * browsing a malicious page could be made to write into someone's insights.
 *
 * Hence `$secure` is deliberately absent: these are not "public" endpoints,
 * they are endpoints with their own credential, resolved by hand below.
 *
 * **`$route`, not `$action`.** `$action` prefixes `/api` and its dispatcher
 * shadows anything else under that prefix, so an ingest endpoint declared there
 * answers 404 to the very client it exists for. The cable posts to a root path.
 */
export class SigilIngestController {
  protected readonly tokens = $inject(SigilTokenService);
  protected readonly ingest = $inject(SigilIngestService);

  /**
   * `POST /sigils/ingest` — one batch from an enrolled app.
   *
   * Answers 204 and nothing else. What the sink is willing to take is a
   * standing answer, not a per-batch one: an app declares what it collects
   * in its own `SIGIL_CONFIG`, and the write gate in `SigilIngestService`
   * drops the rest without a receipt to diff against.
   */
  push = $route({
    method: "POST",
    path: SIGIL_INGEST_PATH,
    schema: {
      body: sigilForwarded,
      headers: z.object({ authorization: z.string().optional() }),
    },
    handler: async ({ body, headers, reply }) => {
      const sigil = await this.resolve(headers.authorization);
      await this.ingest.absorb(sigil, body);
      reply.status = 204;
    },
  });

  /*
   * There was a `GET /sigils/config` here, which told an app how much to send.
   * Nothing asks any more: an app declares what it collects in its own
   * `SIGIL_CONFIG`, because a config fetched at runtime could not survive a
   * serverless isolate (re-fetched on nearly every request, and awaited in
   * front of the first byte) or a prerender (baked into the HTML at build
   * time, unchangeable until the next deploy).
   *
   * `gatesFor` did not go with it. It still runs on the write path below,
   * which is the half that matters: what an app chooses to send is its
   * business, what this sink chooses to keep is ours. A sigil whose `kinds`
   * withhold vitals discards them on arrival no matter what the sender
   * believes.
   */

  /**
   * Turns a bearer header into a sigil, or refuses.
   *
   * 401 for missing, malformed and unknown alike. Distinguishing them would let
   * anyone with the URL discover whether a token ever existed.
   */
  protected async resolve(authorization: string | undefined): Promise<Sigil> {
    const sigil = await this.tokens.verify(this.tokens.bearer(authorization));
    if (!sigil) {
      throw new UnauthorizedError("Unknown sigil token");
    }
    return sigil;
  }
}
