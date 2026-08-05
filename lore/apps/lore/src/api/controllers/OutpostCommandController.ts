import { $inject, Alepha, z } from "alepha";
import { FileService } from "alepha/api/files";
import { $route, NotFoundError, UnauthorizedError } from "alepha/server";
import type { Outpost } from "../entities/outposts.ts";
import { RELEASE_STATUSES } from "../entities/releases.ts";
import { outpostCommands } from "../schemas/outpostCommands.ts";
import { OutpostTokenService } from "../services/OutpostTokenService.ts";
import { ReleaseService } from "../services/ReleaseService.ts";

/**
 * The channel a machine asks for work on.
 *
 * **Nothing here ever reaches out.** Lore holds no address for a Bay and no
 * credential to call one with; the machine comes asking, and this is what it is
 * told. That is what lets a deploy work through a NAT, behind a firewall, with
 * no inbound port and no certificate on the far side — and it is why the
 * control API of Bay can stay a unix socket forever.
 *
 * Same credential as `/outposts/report`, deliberately: the report going up and
 * the commands coming down are one identity, so enrolling a machine is one act
 * and revoking it is one act. A token stolen from a host still opens nothing on
 * that host — it lets someone lie to Lore about a fleet, and now also lets them
 * claim a deploy they cannot execute, which surfaces as a release stuck in
 * `claimed` rather than as an intrusion.
 *
 * **`$route`, not `$action`.** `$action` prefixes `/api` and its dispatcher
 * shadows anything else under that prefix, so these would answer 404 to the
 * very client they exist for.
 */
export class OutpostCommandController {
  protected readonly alepha = $inject(Alepha);
  protected readonly tokens = $inject(OutpostTokenService);
  protected readonly releases = $inject(ReleaseService);
  protected readonly fileService = $inject(FileService);

  /**
   * `POST /outposts/commands` — anything for me?
   *
   * 204 when there is not, which is almost always. The body is empty in both
   * directions on that path, so the cost of a five-second poll is a request
   * rather than a payload.
   *
   * Claiming happens here rather than in a separate call: a machine that asks
   * for work is a machine that is about to do it, and the round-trip in between
   * would be a window where two outposts could take the same release.
   */
  commands = $route({
    method: "POST",
    path: "/outposts/commands",
    schema: {
      headers: z.object({ authorization: z.string().optional() }),
      response: outpostCommands,
    },
    handler: async ({ headers, reply }) => {
      const outpost = await this.resolve(headers.authorization);

      const release = await this.releases.claim(outpost);
      if (!release) {
        reply.status = 204;
        return {};
      }

      return {
        deploy: {
          releaseId: release.id,
          app: release.app,
          environment: release.environment,
          version: release.version,
          sha256: release.sha256,
          downloadUrl: this.artifactUrl(release.id),
          sizeBytes: release.sizeBytes,
        },
      };
    },
  });

  /**
   * `POST /outposts/releases/:releaseId/status` — what became of it.
   *
   * Every transition, not just the last one: `up` is watching this row, and a
   * deploy that only reports its outcome leaves the caller unable to tell a
   * slow pull from a machine that died holding the release.
   */
  reportStatus = $route({
    method: "POST",
    path: "/outposts/releases/:releaseId/status",
    schema: {
      params: z.object({ releaseId: z.uuid() }),
      headers: z.object({ authorization: z.string().optional() }),
      body: z.object({
        status: z.enum([...RELEASE_STATUSES]).meta({ mode: "text" }),
        /** Bay's own sentence. Stored verbatim — it is the part that says what to do. */
        failureReason: z.string().max(2000).optional(),
      }),
    },
    handler: async ({ params, body, headers, reply }) => {
      const outpost = await this.resolve(headers.authorization);

      await this.releases.transition(
        params.releaseId,
        outpost.id,
        body.status,
        body.failureReason,
      );

      reply.status = 204;
    },
  });

  /**
   * `GET /outposts/artifacts/:releaseId` — the bytes.
   *
   * On the machine's own credential, and only for a release **it** claimed. The
   * framework's own download route authorises a session, which an outpost does
   * not have, and the public one would put deployable artifacts on an
   * anonymous URL. Serving them here means the credential that asked for the
   * work is the credential that fetches it, with nothing new to sign or
   * expire.
   */
  artifact = $route({
    method: "GET",
    path: "/outposts/artifacts/:releaseId",
    schema: {
      params: z.object({ releaseId: z.uuid() }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.file(),
    },
    handler: async ({ params, headers }) => {
      const outpost = await this.resolve(headers.authorization);

      const release = await this.releases.get(params.releaseId);
      // Claimed *by this outpost* — not merely visible to it. A machine that
      // has not taken a release has no business pulling its bytes, and 404
      // rather than 403 keeps the existence of other projects' releases from
      // being probeable with a valid token.
      if (!release || release.outpostId !== outpost.id) {
        throw new NotFoundError("No such release claimed by this outpost");
      }

      const file = await this.fileService.getFileById(release.fileId);
      return await this.fileService.streamFile(file);
    },
  });

  /**
   * Where a machine fetches an artifact from.
   *
   * Built from `PUBLIC_URL` because the machine has to be told an absolute
   * address it can reach from outside — a path would be resolved against
   * nothing on the far side.
   */
  protected artifactUrl(releaseId: string): string {
    const base = String(this.alepha.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
    return `${base}/outposts/artifacts/${releaseId}`;
  }

  /**
   * Turns a bearer header into an outpost, or refuses.
   *
   * 401 for missing, malformed and unknown alike. Telling them apart would let
   * anyone holding the URL discover whether a token ever existed.
   */
  protected async resolve(authorization: string | undefined): Promise<Outpost> {
    const outpost = await this.tokens.verify(this.tokens.bearer(authorization));
    if (!outpost) {
      throw new UnauthorizedError("Unknown outpost token");
    }
    return outpost;
  }
}
