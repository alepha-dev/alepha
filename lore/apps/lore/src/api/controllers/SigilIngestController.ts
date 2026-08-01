import { sigilConfig } from "@alepha/sigil/config";
import { sigilForwarded } from "@alepha/sigil/envelope";
import { SIGIL_CONFIG_PATH, SIGIL_INGEST_PATH } from "@alepha/sigil/paths";
import { $inject, Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { $route, UnauthorizedError } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import type { Sigil, SigilKind } from "../entities/sigils.ts";
import { SigilIngestService } from "../services/SigilIngestService.ts";
import { SigilTokenService } from "../services/SigilTokenService.ts";

/**
 * Where enrolled apps report, and where they ask how much to report.
 *
 * **A separate realm from everything else in Lore, in both directions.** These
 * two endpoints accept a sigil token and nothing else — an authenticated
 * campaign member is not enough to post telemetry, and a sigil token opens
 * nothing but these two routes.
 *
 * The asymmetry matters more than it looks. A sigil token exists in cleartext
 * on every machine that runs the environment it belongs to; treating it as an
 * authentication of any kind would hand out Lore's campaign surface with it.
 * Conversely, accepting the session cookie here would mean a logged-in owner
 * browsing a malicious page could be made to write into someone's telemetry.
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
  protected readonly campaigns = $repository(campaigns);

  /**
   * `POST /sigils/ingest` — one telemetry batch.
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
   * `GET /sigils/config` — how much this environment should send.
   *
   * Built from the campaign's toggles intersected with the sigil's own kinds,
   * so the answer is exactly what `SigilIngestService.absorb` would accept.
   * Anything else would have an app spending bandwidth on payloads the sink
   * discards on arrival.
   *
   * `sampling` is deliberately absent: Lore has no per-campaign rate to tune,
   * and the package already defaults to keeping everything.
   */
  config = $route({
    method: "GET",
    path: SIGIL_CONFIG_PATH,
    schema: {
      headers: z.object({ authorization: z.string().optional() }),
      response: sigilConfig,
    },
    handler: async ({ headers }) => {
      const sigil = await this.resolve(headers.authorization);
      const campaign = await this.campaigns.findOne({
        where: { id: { eq: sigil.campaignId } },
      });

      // A sigil whose campaign is gone reports nothing. It cannot normally
      // happen — `sigils.campaignId` cascades — but answering "everything on"
      // to a token with no campaign behind it is the wrong default.
      const features = campaign?.features;
      const master = features?.sigils === true;

      return {
        enabled: {
          views:
            master &&
            features?.beacon === true &&
            this.carries(sigil, "beacon"),
          errors:
            master &&
            features?.blights === true &&
            this.carries(sigil, "blights"),
          vitals:
            master &&
            features?.vitals === true &&
            this.carries(sigil, "vitals"),
        },
        ...(master &&
        features?.petitions === true &&
        this.carries(sigil, "petition")
          ? {
              petitionUrl: `${this.publicUrl()}/c/${sigil.campaignId}/request`,
            }
          : {}),
      };
    },
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

  protected carries(sigil: Sigil, kind: SigilKind): boolean {
    return (sigil.kinds ?? []).includes(kind);
  }

  /**
   * Absolute base for the petition link, or empty when `PUBLIC_URL` is unset —
   * in which case the link degrades to a relative path rather than pointing at
   * a host this instance cannot name.
   */
  protected publicUrl(): string {
    return String(this.alepha.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  }
}
