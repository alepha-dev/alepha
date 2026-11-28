import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  $route,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "alepha/server";

import { type HostCommand, hostCommands } from "../entities/hostCommands.ts";
import {
  hostBackupsListResultSchema,
  hostBackupVerifyResultSchema,
  hostRestoreResultSchema,
  hostTargetProbeResultSchema,
} from "../schemas/hostBackupResultSchemas.ts";
import { hostCommandResultSchema } from "../schemas/hostCommandResultSchema.ts";
import type { HostCommandKind } from "../schemas/hostCommandValues.ts";
import { CoreBuckets } from "../services/CoreBuckets.ts";
import { HostJobService } from "../services/HostJobService.ts";
import { HostTokenService } from "../services/HostTokenService.ts";

type SafeParsed =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: { message: string } };

/**
 * What a machine reaches by command id that is not deploying (#E166, split
 * from Ship's `HostPullController`): the answer a command uploads (a log
 * tail, a backup listing) and the spec of the job a `job-run` carries.
 *
 * The same rules as Ship's pulls: root `$route`s under the Bay wire v1
 * prefix `/estates/commands`, the host secret as bearer, a 401 for a bad
 * one, and ONE 404 for every other refusal, so a machine holding one host's
 * secret learns nothing about another host's queue.
 */
export class HostCommandPullController {
  public static readonly RESULT_PATH = "/estates/commands/:id/result";

  /**
   * A `job-run`'s spec (#Q3983, #Q3984): the structured job Bay validates
   * and builds a command line from.
   */
  public static readonly JOB_PATH = "/estates/commands/:id/job";

  /**
   * Where a running job's Bay asks for a fresh GitHub token (#Q4361).
   */
  public static readonly GITHUB_TOKEN_PATH =
    "/estates/commands/:id/github-token";

  /**
   * Where a command's answer is stored. Its own bucket, because what is in it
   * is a machine's journal: bounded, short-lived and read by one owner.
   */
  public static readonly RESULT_BUCKET = CoreBuckets.RESULT_BUCKET;

  /**
   * How much of an answer this route accepts. Bay cuts to fit and reports
   * what it dropped; anything over this is refused whole rather than
   * truncated silently.
   */
  public static readonly MAX_RESULT_BYTES = 1024 * 1024;

  /**
   * The answer each kind uploads, by kind. A kind absent here answers with
   * its ack alone, and an upload for it is refused like a foreign id.
   */
  public static readonly RESULT_SCHEMAS: Partial<
    Record<HostCommandKind, { safeParse: (v: unknown) => SafeParsed }>
  > = {
    logs: hostCommandResultSchema,
    "backups-list": hostBackupsListResultSchema,
    "backup-verify": hostBackupVerifyResultSchema,
    "target-probe": hostTargetProbeResultSchema,
    restore: hostRestoreResultSchema,
  };

  /**
   * How long a stored answer lives. A log tail is read once, minutes after it
   * was asked for; keeping it a day is generous and keeping it forever is a
   * bucket that only grows.
   */
  public static readonly RESULT_TTL_HOURS = 24;

  protected readonly log = $logger();
  protected readonly tokens = $inject(HostTokenService);
  protected readonly files = $inject(FileService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly commands = $repository(hostCommands);
  protected readonly hostJobs = $inject(HostJobService);

  /**
   * The bucket, declared on core's `CoreBuckets` (#E166) so that this controller holds no boot
   * primitive and stays pure (#Q3404): a `$storage` is looked up by name on
   * every upload, so it must exist at boot.
   */
  protected readonly buckets = $inject(CoreBuckets);

  public get resultBucket() {
    return this.buckets.pullResults;
  }

  pushResult = $route({
    method: "POST",
    path: HostCommandPullController.RESULT_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      // Validated per kind in the handler, once the command says which
      // answer it is waiting for.
      body: z.record(z.string(), z.any()),
      response: z.object({ stored: z.boolean() }),
    },
    handler: async ({ params, headers, body: raw }) => {
      const command = await this.resolve(params.id, headers.authorization);
      const schema = HostCommandPullController.RESULT_SCHEMAS[command.kind];
      if (!schema) {
        this.log.warn("Command result refused: this kind has no answer", {
          commandId: command.id,
          kind: command.kind,
        });
        throw this.refused();
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new BadRequestError(
          `The ${command.kind} answer does not match what Lore reads: ${parsed.error.message.slice(0, 500)}`,
        );
      }
      const body = parsed.data;
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
      if (bytes.byteLength > HostCommandPullController.MAX_RESULT_BYTES) {
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
          bucket: HostCommandPullController.RESULT_BUCKET,
          expirationDate: new Date(
            this.dateTime.nowMillis() +
              HostCommandPullController.RESULT_TTL_HOURS * 3600_000,
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
   * `GET /estates/commands/:id/job`: the spec of the job a `job-run`
   * carries, with the job key minted for this pull. Never logged, never
   * cached: it holds the key. Refused like every other pull for a command
   * that is not this host's, not open, or not a `job-run`.
   */
  pullJob = $route({
    method: "GET",
    path: HostCommandPullController.JOB_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.record(z.string(), z.any()),
    },
    handler: async ({ params, headers, reply, url }) => {
      const command = await this.resolve(params.id, headers.authorization);
      const jobId = command.payload.jobId;
      if (command.kind !== "job-run" || !jobId) {
        throw this.refused();
      }
      const job = await this.hostJobs.getRow(jobId).catch(() => undefined);
      if (!job || job.hostId !== command.hostId || job.status !== "running") {
        throw this.refused();
      }
      reply.setHeader("cache-control", "no-store");
      return this.hostJobs.spec(job, url.origin);
    },
  });

  /**
   * `GET /estates/commands/:id/github-token`: a fresh GitHub token for the
   * running job a `job-run` carries (#Q4361, #Q4365), with the job's own
   * permission set. Refused, like every pull, for a command that is not
   * this host's or not open, and for a job that ended or carries no token.
   * Never logged, never cached.
   */
  renewJobGitHub = $route({
    method: "GET",
    path: HostCommandPullController.GITHUB_TOKEN_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.record(z.string(), z.any()),
    },
    handler: async ({ params, headers, reply }) => {
      const command = await this.resolve(params.id, headers.authorization);
      const jobId = command.payload.jobId;
      if (command.kind !== "job-run" || !jobId) {
        throw this.refused();
      }
      const job = await this.hostJobs.getRow(jobId).catch(() => undefined);
      if (!job || job.hostId !== command.hostId) {
        throw this.refused();
      }
      const github = await this.hostJobs.renewGitHub(job);
      if (!github) {
        throw this.refused();
      }
      reply.setHeader("cache-control", "no-store");
      return github;
    },
  });

  /**
   * The bearer, then the command it may pull for: ONE query scoped on id,
   * host and open state, so a foreign command and an absent one are the
   * same empty result.
   */
  protected async resolve(
    id: string,
    authorization: string | undefined,
  ): Promise<HostCommand> {
    const host = await this.tokens.verify(this.tokens.bearer(authorization));
    if (!host) {
      throw new UnauthorizedError("Invalid host secret");
    }
    const command = await this.commands.findOne({
      where: {
        id: { eq: id },
        hostId: { eq: host.id },
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
