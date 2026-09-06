import { $inject, z } from "alepha";
import { $storage, FileService } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $route, NotFoundError, UnauthorizedError } from "alepha/server";

import { artifacts } from "../entities/artifacts.ts";
import {
  type EstateCommand,
  estateCommands,
} from "../entities/estateCommands.ts";
import { estateCommandResultSchema } from "../schemas/estateCommandResultSchema.ts";
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
  public static readonly RESULT_PATH = "/estates/commands/:id/result";

  /**
   * Where a command's answer is stored. Its own bucket, because what is in it
   * is a machine's journal: bounded, short-lived and read by one owner.
   */
  public static readonly RESULT_BUCKET = "estate-command-results";

  /**
   * How much of an answer this route accepts. Bay cuts to fit and reports
   * what it dropped; anything over this is refused whole rather than
   * truncated silently.
   */
  public static readonly MAX_RESULT_BYTES = 1024 * 1024;

  /**
   * How long a stored answer lives. A log tail is read once, minutes after it
   * was asked for; keeping it a day is generous and keeping it forever is a
   * bucket that only grows.
   */
  public static readonly RESULT_TTL_HOURS = 24;

  protected readonly log = $logger();
  protected readonly tokens = $inject(EstateTokenService);
  protected readonly files = $inject(FileService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly commands = $repository(estateCommands);
  protected readonly artifacts = $repository(artifacts);

  resultBucket = $storage({
    name: EstatePullController.RESULT_BUCKET,
    description: "What a machine answered a logs command with",
    maxSize: 1,
    mimeTypes: ["application/json"],
  });

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
   * `POST /estates/commands/:id/result`: the answer to a command whose
   * result is a payload rather than an ack.
   *
   * The protocol has no reply channel - a machine sends `hello`, `ack`,
   * `stats` and `inventory`, and none of them carries a body - so rather than
   * invent one, the answer goes over the seam that already has the right
   * shape: machine-facing, addressed by command id, estate secret as bearer.
   *
   * ⚠️ **Accepted once.** A command that already holds a `resultFileId` is
   * refused with the same 404 as everything else here, so a redelivered
   * upload cannot replace an answer the owner may already be reading.
   *
   * ⚠️ **Before the terminal ack.** `resolve()` accepts a command only while
   * it is `sent` or `running`, so the machine must upload and then ack, never
   * the other way round. C4b carries that ordering.
   *
   * The stored blob expires in 24 hours and is swept by the framework's own
   * `FileJobs`, which is why `EstateCommandJobs` learns nothing here and an
   * estate deletion needs no blob hook.
   */
  pushResult = $route({
    method: "POST",
    path: EstatePullController.RESULT_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      body: estateCommandResultSchema,
      response: z.object({ stored: z.boolean() }),
    },
    handler: async ({ params, headers, body }) => {
      const command = await this.resolve(params.id, headers.authorization);
      if (command.resultFileId) {
        // Already answered. Refused rather than replaced: the owner may be
        // reading the first answer, and a redelivery is not a new one.
        this.log.warn("Command result refused: this command already has one", {
          commandId: command.id,
        });
        throw this.refused();
      }

      // Re-serialised here rather than stored as the raw request body,
      // because what is written is what the schema accepted: a machine
      // cannot smuggle a field past the bounds by sending bytes the parser
      // dropped. The cap is on those bytes, so it means the same thing as
      // what the bucket holds.
      const bytes = new TextEncoder().encode(JSON.stringify(body));
      if (bytes.byteLength > EstatePullController.MAX_RESULT_BYTES) {
        this.log.warn("Command result refused: over the size cap", {
          commandId: command.id,
          bytes: bytes.byteLength,
        });
        throw this.refused();
      }

      const stored = await this.files.uploadFile(
        new File([bytes], `command-${command.id}.json`, {
          type: "application/json",
        }),
        {
          bucket: EstatePullController.RESULT_BUCKET,
          expirationDate: new Date(
            this.dateTime.nowMillis() +
              EstatePullController.RESULT_TTL_HOURS * 3600_000,
          ).toISOString(),
        },
      );
      await this.commands.updateById(command.id, { resultFileId: stored.id });
      this.log.info("Command result stored", {
        commandId: command.id,
        bytes: bytes.byteLength,
      });
      return { stored: true };
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
