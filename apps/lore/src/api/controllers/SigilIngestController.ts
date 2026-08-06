import { sigilConfig } from "@alepha/sigil/config";
import { sigilForwarded } from "@alepha/sigil/envelope";
import { SIGIL_CONFIG_PATH, SIGIL_INGEST_PATH } from "@alepha/sigil/paths";
import { $inject, Alepha, z } from "alepha";
import { $route, UnauthorizedError } from "alepha/server";
import type { Sigil } from "../entities/sigils.ts";
import { SigilIngestService } from "../services/SigilIngestService.ts";
import { SigilTokenService } from "../services/SigilTokenService.ts";

/**
 * Where enrolled apps report, and where they ask how much to report.
 *
 * **A separate realm from everything else in Lore, in both directions.** These
 * two endpoints accept a sigil token and nothing else — an authenticated
 * project member is not enough to report into a project, and a sigil token
 * opens nothing but these two routes.
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
  protected readonly alepha = $inject(Alepha);
  protected readonly tokens = $inject(SigilTokenService);
  protected readonly ingest = $inject(SigilIngestService);

  /**
   * `POST /sigils/ingest` — one batch from an enrolled app.
   *
   * Answers 204 and nothing else. What the sink is willing to take is a
   * standing answer, not a per-batch one, and it is served by `/sigils/config`
   * — an app learns its vitals are being dropped from the kill-switch it polls,
   * not from a receipt it would have to diff against what it sent.
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

  /**
   * `GET /sigils/config` — how much this app should send.
   *
   * The answer is exactly what `SigilIngestService.absorb` would accept,
   * because it is the same call: `gatesFor` is the one place the project's
   * toggles are intersected with the sigil's kinds, and both the gate and this
   * advertisement read it. Restating the rule here is how a sink ends up
   * inviting payloads it then discards on arrival.
   *
   * `sampling` is deliberately absent: Lore has no per-project rate to tune,
   * and the package already defaults to keeping everything.
   */
  config = $route({
    method: "GET",
    path: SIGIL_CONFIG_PATH,
    schema: {
      headers: z.object({ authorization: z.string().optional() }),
      response: sigilConfig,
    },
    handler: async ({ headers }) =>
      await this.ingest.configFor(await this.resolve(headers.authorization)),
  });

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
