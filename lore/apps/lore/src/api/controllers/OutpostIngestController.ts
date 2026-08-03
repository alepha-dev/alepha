import { $inject, z } from "alepha";
import { $route, UnauthorizedError } from "alepha/server";
import type { Outpost } from "../entities/outposts.ts";
import { outpostReport } from "../schemas/outpostReport.ts";
import { OutpostIngestService } from "../services/OutpostIngestService.ts";
import { OutpostTokenService } from "../services/OutpostTokenService.ts";

/**
 * Where enrolled machines report.
 *
 * **Its own credential, in both directions**, exactly as `/sigils/ingest` is.
 * An authenticated campaign member cannot post a fleet report, and an outpost
 * token opens nothing but this route. Accepting the session cookie here would
 * mean a logged-in owner browsing a hostile page could be made to rewrite their
 * own infrastructure view; accepting an outpost token anywhere else would hand
 * out Lore's campaign surface to a credential that sits on a server.
 *
 * `$secure` is therefore deliberately absent: this is not a public endpoint, it
 * is an endpoint with its own credential, resolved by hand below.
 *
 * **`$route`, not `$action`.** `$action` prefixes `/api` and its dispatcher
 * shadows anything else under that prefix, so an ingest endpoint declared there
 * answers 404 to the very client it exists for.
 */
export class OutpostIngestController {
  protected readonly tokens = $inject(OutpostTokenService);
  protected readonly ingest = $inject(OutpostIngestService);

  /**
   * `POST /outposts/report` — one machine's whole world.
   *
   * Answers 204. There is nothing useful to say back: the machine sends the
   * same snapshot again in a minute regardless, so a receipt would only be a
   * thing to diff and get wrong.
   */
  report = $route({
    method: "POST",
    path: "/outposts/report",
    schema: {
      body: outpostReport,
      headers: z.object({ authorization: z.string().optional() }),
    },
    handler: async ({ body, headers, reply }) => {
      const outpost = await this.resolve(headers.authorization);
      await this.ingest.absorb(outpost, body);
      reply.status = 204;
    },
  });

  /**
   * Turns a bearer header into an outpost, or refuses.
   *
   * 401 for missing, malformed and unknown alike. Distinguishing them would let
   * anyone with the URL discover whether a token ever existed.
   */
  protected async resolve(authorization: string | undefined): Promise<Outpost> {
    const outpost = await this.tokens.verify(this.tokens.bearer(authorization));
    if (!outpost) {
      throw new UnauthorizedError("Unknown outpost token");
    }
    return outpost;
  }
}
