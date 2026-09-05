import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $route, NotFoundError, UnauthorizedError } from "alepha/server";

import { artifacts } from "../entities/artifacts.ts";
import {
  type EstateCommand,
  estateCommands,
} from "../entities/estateCommands.ts";
import { ArtifactService } from "../services/ArtifactService.ts";
import { EstateTokenService } from "../services/EstateTokenService.ts";

/**
 * What a machine pulls while executing a `deploy`: the artifact bytes and
 * the environment's secret set, each addressed by the command's id (#1844).
 *
 * ## Bay pulls, the command never carries
 *
 * A `command` frame names an artifact by digest and nothing else, and it is
 * redelivered from `estate_commands` on every reconnect (#1782), so anything
 * it carried would sit in D1 until the sweep. Secrets and bytes are pulled
 * here instead, at execution time: a secret rotated between enqueue and
 * execute is the one delivered, and the queue table holds nothing that must
 * not sit in a database. The machine reads what one command it was handed
 * needs; it cannot name an environment, a project or a file.
 *
 * ## Root-level `$route`s, like `SigilIngestController`
 *
 * Never under `/api`: the `$action` dispatcher shadows that prefix. The
 * bearer is the estate secret, verified by `EstateTokenService` as a hash
 * comparison; no session, no user, the same shape as the websocket
 * handshake. A missing or unknown secret is a 401 before any command is
 * looked up. Past that, every failure is the SAME 404: a command of another
 * estate, a command already terminal, a `pending` one the machine was never
 * sent, an id that exists nowhere. A machine holding estate A's secret
 * learns nothing about estate B's queue from the difference between "not
 * yours" and "not there", because there is no difference.
 *
 * `sent` and `running` are the two states in which the machine legitimately
 * holds the command: it was pushed and not yet acknowledged, or it is
 * executing. A `deploy` that finished cannot re-fetch its artifact; a retry
 * is a new command.
 */
export class EstatePullController {
  public static readonly ARTIFACT_PATH = "/estates/commands/:id/artifact";
  public static readonly SECRETS_PATH = "/estates/commands/:id/secrets";

  protected readonly log = $logger();
  protected readonly tokens = $inject(EstateTokenService);
  protected readonly files = $inject(FileService);
  protected readonly commands = $repository(estateCommands);
  protected readonly artifacts = $repository(artifacts);

  /**
   * `GET /estates/commands/:id/artifact`: the bytes the command names.
   *
   * Streamed from the artifact bucket, with `content-length` from the row
   * and the digest in `x-artifact-sha256`, so the connector can verify what
   * it unpacks (#1622) and can tell a truncated download from a complete
   * one. The digest is the artifact's identity, and the command carries a
   * snapshot of it: if the row has moved on since the command was queued (a
   * forced re-push of the same tag), the bytes the command promised no
   * longer exist, and that is a 404 rather than different bytes under the
   * same command.
   */
  pullArtifact = $route({
    method: "GET",
    path: EstatePullController.ARTIFACT_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.file(),
    },
    handler: async ({ params, headers, reply }) => {
      const command = await this.resolve(params.id, headers.authorization);
      const named = command.payload.artifact;
      const artifact = named
        ? await this.artifacts.findOne({ where: { id: { eq: named.id } } })
        : undefined;
      if (!artifact || artifact.sha256 !== named?.sha256) {
        this.log.warn(
          "Artifact pull refused: the command names no current artifact",
          {
            commandId: command.id,
          },
        );
        throw this.refused();
      }

      const file = await this.files.streamFile(artifact.fileId, {
        bucket: ArtifactService.BUCKET,
      });
      reply.setHeader("content-length", String(artifact.size));
      reply.setHeader("x-artifact-sha256", artifact.sha256);
      reply.setHeader("cache-control", "no-store");
      return file;
    },
  });

  /**
   * `GET /estates/commands/:id/secrets`: the env secret set for the
   * command's `(project, environment)`, as `{ [key]: value }`.
   *
   * ⚠️ Empty on purpose, and not a bug. There is no secret store yet: that
   * is epic #1's #1813, which fills this handler in. The route ships now so
   * the wire contract exists and the connector's side (#1622) is real and
   * testable against it; a deploy today runs with an empty environment.
   *
   * ⚠️ The response is never logged, never cached and never audited by
   * body. `cache-control: no-store` is set here rather than left to a
   * default, and the one log line names the command id and nothing else.
   * Keep it that way when #1813 lands.
   */
  pullSecrets = $route({
    method: "GET",
    path: EstatePullController.SECRETS_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.record(z.string(), z.string()),
    },
    handler: async ({ params, headers, reply }) => {
      const command = await this.resolve(params.id, headers.authorization);
      reply.setHeader("cache-control", "no-store");
      this.log.debug("Secret set pulled", { commandId: command.id });
      return {};
    },
  });

  /**
   * The bearer, then the command it may pull for.
   *
   * The lookup is ONE query scoped on all three facts at once (id, estate,
   * open state), so there is no path on which the id is found first and the
   * estate checked second: a foreign command and an absent one are the same
   * empty result.
   */
  protected async resolve(
    id: string,
    authorization: string | undefined,
  ): Promise<EstateCommand> {
    const estate = await this.tokens.verify(this.tokens.bearer(authorization));
    if (!estate) {
      throw new UnauthorizedError("Invalid estate secret");
    }

    const command = await this.commands.findOne({
      where: {
        id: { eq: id },
        estateId: { eq: estate.id },
        status: { inArray: ["sent", "running"] },
      },
    });
    if (!command) {
      throw this.refused();
    }
    return command;
  }

  /**
   * One message for every refusal past the bearer, by construction.
   */
  protected refused(): NotFoundError {
    return new NotFoundError("No such command");
  }
}
