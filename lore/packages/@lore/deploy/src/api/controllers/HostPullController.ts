import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { BAY_OWNED_SECRET_KEYS } from "alepha/cli/infra-lib";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  $route,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { type HostCommand, hostCommands } from "../entities/hostCommands.ts";
import {
  hostBackupsListResultSchema,
  hostBackupVerifyResultSchema,
  hostRestoreResultSchema,
  hostTargetProbeResultSchema,
} from "../schemas/hostBackupResultSchemas.ts";
import { hostCommandResultSchema } from "../schemas/hostCommandResultSchema.ts";
import type { HostCommandKind } from "../schemas/hostCommandValues.ts";
import { stackDeployOutcomeSchema } from "../schemas/stackDeployOutcomeSchema.ts";
import { AppSecretService } from "../services/AppSecretService.ts";
import { ArtifactService } from "../services/ArtifactService.ts";
import { DeployBuckets } from "../services/DeployBuckets.ts";
import { HostTokenService } from "../services/HostTokenService.ts";
import { StackDeployService } from "../services/StackDeployService.ts";

/**
 * What a machine pulls while executing a `deploy`: the artifact bytes and
 * the environment's secret set, each addressed by the command's id (#1844).
 *
 * ## Bay pulls, the command never carries
 *
 * A `command` frame names an artifact by digest and nothing else, and it is
 * redelivered from `host_commands` on every reconnect (#1782), so anything
 * it carried would sit in D1 until the sweep. Secrets and bytes are pulled
 * here instead, at execution time: a secret rotated between enqueue and
 * execute is the one delivered, and the queue table holds nothing that must
 * not sit in a database. The machine reads what one command it was handed
 * needs; it cannot name an environment, a project or a file.
 *
 * ## Root-level `$route`s, like `SigilIngestController`
 *
 * Never under `/api`: the `$action` dispatcher shadows that prefix. The
 * bearer is the host secret, verified by `HostTokenService` as a hash
 * comparison; no session, no user, the same shape as the websocket
 * handshake. A missing or unknown secret is a 401 before any command is
 * looked up. Past that, every failure is the SAME 404: a command of another
 * host, a command already terminal, a `pending` one the machine was never
 * sent, an id that exists nowhere. A machine holding host A's secret
 * learns nothing about host B's queue from the difference between "not
 * yours" and "not there", because there is no difference.
 *
 * `sent` and `running` are the two states in which the machine legitimately
 * holds the command: it was pushed and not yet acknowledged, or it is
 * executing. A `deploy` that finished cannot re-fetch its artifact; a retry
 * is a new command.
 */
type SafeParsed =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: { message: string } };

export class HostPullController {
  /*
   * Bay wire v1: every pull path keeps `/estates/commands`, the word Lore
   * used before #E147, because every running Bay builds these URLs
   * (`pull.go`) and a new spelling would need a binary swap on every host.
   */
  public static readonly ARTIFACT_PATH = "/estates/commands/:id/artifact";
  public static readonly SECRETS_PATH = "/estates/commands/:id/secrets";
  public static readonly APP_SECRET_PATH = "/estates/commands/:id/app-secret";
  public static readonly RESULT_PATH = "/estates/commands/:id/result";

  /**
   * `GET`: a `stack-deploy`'s registry credentials, opened. `POST` on
   * `OUTCOME_PATH`: what the machine did when it applied the revision.
   */
  public static readonly REGISTRIES_PATH = "/estates/commands/:id/registries";
  public static readonly OUTCOME_PATH = "/estates/commands/:id/outcome";

  /**
   * Where a command's answer is stored. Its own bucket, because what is in it
   * is a machine's journal: bounded, short-lived and read by one owner.
   */
  public static readonly RESULT_BUCKET = DeployBuckets.RESULT_BUCKET;

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
  protected readonly instances = $repository(appInstances);
  protected readonly artifacts = $repository(artifacts);
  protected readonly secrets = $inject(AppSecretService);
  protected readonly stackDeploys = $inject(StackDeployService);

  /**
   * The bucket, declared on `DeployBuckets` so that this controller holds no boot
   * primitive and stays pure (#Q3404): a `$storage` is looked up by name on
   * every upload, so it must exist at boot.
   */
  protected readonly buckets = $inject(DeployBuckets);

  public get resultBucket() {
    return this.buckets.pullResults;
  }

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
    path: HostPullController.ARTIFACT_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.file(),
    },
    handler: async ({ params, headers, reply }) => {
      const command = await this.resolve(params.id, headers.authorization);
      if (command.kind === "stack-deploy") {
        // A revision bundle, resolved through the deploy row the command
        // belongs to, never through the artifacts table.
        const bundle = await this.stackDeploys.bundleFor(command);
        if (!bundle) {
          this.log.warn(
            "Bundle pull refused: the command names no revision of its deploy",
            {
              commandId: command.id,
            },
          );
          throw this.refused();
        }
        const stream = await this.files.streamFile(bundle.fileId, {
          bucket: StackDeployService.BUCKET,
        });
        reply.setHeader("content-length", String(bundle.size));
        reply.setHeader("x-artifact-sha256", bundle.sha256);
        reply.setHeader("cache-control", "no-store");
        return stream;
      }
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

      // ⚠️ An image row has no `fileId` and often no `size`: Lore records a
      // registry reference and never the bytes. Nothing should ever queue a
      // deploy command naming one (`HostCommandController` refuses it, and
      // so does `DeployService`), so reaching here means a row changed shape
      // under a queued command - which is the same fact `refused()` already
      // states, and it stays opaque for the same reason.
      const { fileId, size } = artifact;
      if (!fileId || size === undefined) {
        this.log.warn("Artifact pull refused: the row stores no bytes", {
          commandId: command.id,
          format: artifact.format,
        });
        throw this.refused();
      }

      const file = await this.files.streamFile(fileId, {
        bucket: ArtifactService.BUCKET,
      });
      reply.setHeader("content-length", String(size));
      reply.setHeader("x-artifact-sha256", artifact.sha256);
      reply.setHeader("cache-control", "no-store");
      return file;
    },
  });

  /**
   * `GET /estates/commands/:id/secrets`: what the Bay instance this command
   * targets should run with, as `{ [key]: value }`.
   *
   * ⚠️ **The instance is resolved from the HOST and the payload, never from
   * anything the machine sends.** The bearer proves which host is asking,
   * `payload.app` / `payload.environment` say which of its instances, and the
   * `app_instances` row is matched on all three. A host lent to two
   * projects that each named `acme/production` on it is therefore ambiguous,
   * and ambiguity is refused rather than resolved by taking the first row: the
   * wrong answer here hands one project's production secrets to another's
   * machine.
   *
   * ⚠️ Empty is still a legitimate answer - a copy with no variables set - and
   * it is what a host had before this landed. It is not a signal of failure.
   *
   * ⚠️ **Bay's own names are left out** (`BAY_OWNED_SECRET_KEYS`, the mirror
   * of Bay's `bayOwnedKeys`). Bay writes them into every instance itself and
   * refuses a secret set holding one, which fails the whole deploy - and a
   * copy first deployed on a Cloudflare host carries two, APP_SECRET and
   * APP_NAME, stored by that deploy. The rows are kept rather than deleted:
   * they are that copy's durable state if it ever goes back. Only a Bay
   * machine holds a host secret, so this route never answers anything else.
   *
   * ⚠️ The response is never logged, never cached and never audited by body.
   * `cache-control: no-store` is set here rather than left to a default, and
   * the one log line names the command id and how MANY variables went, never
   * which or what.
   */
  pullSecrets = $route({
    method: "GET",
    path: HostPullController.SECRETS_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.record(z.string(), z.string()),
    },
    handler: async ({ params, headers, reply }) => {
      const command = await this.resolve(params.id, headers.authorization);
      reply.setHeader("cache-control", "no-store");

      if (command.kind === "stack-deploy") {
        // The stack environment's own variables, through its deploy row.
        const set = await this.stackDeploys.variablesFor(command);
        if (!set) {
          throw this.refused();
        }
        this.log.debug("Stack variables pulled", {
          commandId: command.id,
          count: Object.keys(set).length,
        });
        return set;
      }

      if (command.kind === "deploy" && command.payload.instanceId) {
        // A stack member's deploy names its copy: its host is the stack
        // environment's, so the host-and-name lookup below cannot find it.
        const set = await this.stackDeploys.memberSecretsFor(command);
        if (!set) {
          throw this.refused();
        }
        return set;
      }

      const matches = await this.instances.findMany({
        where: {
          hostId: { eq: command.hostId },
          app: { eq: command.payload.app },
          env: { eq: command.payload.environment },
        },
      });
      if (matches.length === 0) {
        // ⚠️ Empty, not a refusal. Not every command comes from a deployed
        // copy Lore knows about - `restart`, `logs` and `stop` name a Bay
        // instance by the two strings the operator typed - and a machine
        // executing one of those must not be told "no such command" for asking
        // a question with a legitimate empty answer.
        this.log.debug("Secret set pulled", {
          commandId: command.id,
          count: 0,
        });
        return {};
      }
      if (matches.length > 1) {
        // Two projects lending one host can each name `acme/production` on
        // it. That is ambiguity, and the wrong answer here hands one project's
        // production secrets to another's machine, so it is refused rather
        // than resolved by taking the first row.
        this.log.warn(
          "Secret set refused: the command names more than one copy",
          {
            commandId: command.id,
            matches: matches.length,
          },
        );
        throw this.refused();
      }

      const set = await this.secrets.open(matches[0].id, {
        except: BAY_OWNED_SECRET_KEYS,
      });
      this.log.debug("Secret set pulled", {
        commandId: command.id,
        count: Object.keys(set).length,
      });
      return set;
    },
  });

  /**
   * `GET /estates/commands/:id/app-secret`: what Lore holds of the
   * `APP_SECRET` of the copy this `deploy` deploys.
   *
   * `{ sha256 }`, the hex SHA-256 of the stored key, or `{}` when Lore holds
   * none; `value` beside it only with `?value=1`, which Bay asks for only for
   * an instance that has no key of its own (a rebuilt host, a copy moved
   * from another host). A routine deploy carries a hash, never the key.
   * The hash is computed from the opened seal at request time: no hash is
   * stored, since a stored hash of an operator-typed key would be a second,
   * weaker copy at rest.
   *
   * ⚠️ **Its own route, never a field of the secret set.** That set is a
   * flat record Bay writes as a secrets file and runs through
   * `refuseBayOwned`: `APP_SECRET` inside it fails the deploy of every Bay
   * older than this route. A Bay that predates the route never calls it.
   *
   * The copy is found the way the secret set finds it: by host and
   * `(app, environment)`, ambiguity refused; a stack member by
   * `payload.instanceId`, only when its deploy row carries this command. Any
   * other command is refused like an unknown one. Same no-store and no-log
   * rules as the secret set: the one log line names the command and whether a
   * value went, never the value nor the hash.
   */
  pullAppSecret = $route({
    method: "GET",
    path: HostPullController.APP_SECRET_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      query: z.object({ value: z.string().max(8).optional() }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.object({
        sha256: z.string().optional(),
        value: z.string().optional(),
      }),
    },
    handler: async ({ params, query, headers, reply }) => {
      const command = await this.resolve(params.id, headers.authorization);
      reply.setHeader("cache-control", "no-store");
      if (command.kind !== "deploy") {
        throw this.refused();
      }
      const instanceId = await this.deployedCopy(command);
      const key = instanceId
        ? await this.secrets.openGenerated(instanceId)
        : undefined;
      const withValue = query.value === "1" && !!key;
      this.log.debug("App secret pulled", {
        commandId: command.id,
        held: !!key,
        value: withValue,
      });
      if (!key) {
        return {};
      }
      const sha256 = await this.sha256(key);
      return withValue ? { sha256, value: key } : { sha256 };
    },
  });

  /**
   * `PUT /estates/commands/:id/app-secret`: the key the machine runs this
   * copy on, escrowed so a rebuilt host gets it back.
   *
   * Bay sends it once its deploy has succeeded and before its terminal ack
   * (`resolve` answers only a command that is `sent` or `running`), and only
   * when the hash it was answered is missing or differs. Its own route, never
   * the command result nor the ack: a result is stored as a file the owner
   * reads, and a key must never land there.
   *
   * Stored sealed only, through {@link AppSecretService.escrow}. A row that
   * held a different key is overwritten and said, never silently: a line on
   * this deploy's log in Lore, naming no value, and `replaced` in the answer,
   * which Bay logs the same. The replaced value is gone for good, and a
   * mismatch no move, restore or `bay secret replace` explains means
   * something else wrote the row.
   */
  pushAppSecret = $route({
    method: "PUT",
    path: HostPullController.APP_SECRET_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      body: z.object({
        value: z.string().min(1).max(AppSecretService.MAX_VALUE_LENGTH),
      }),
      response: z.object({ stored: z.boolean(), replaced: z.boolean() }),
    },
    handler: async ({ params, headers, body }) => {
      const command = await this.resolve(params.id, headers.authorization);
      if (command.kind !== "deploy") {
        throw this.refused();
      }
      const instanceId = await this.deployedCopy(command);
      if (!instanceId) {
        // No copy Lore knows: there is no row to hold the key on.
        throw this.refused();
      }
      const result = await this.secrets.escrow(instanceId, body.value);
      if (result.replaced) {
        await this.stackDeploys.noteOnDeploy(
          command,
          "Lore held another APP_SECRET for this copy and now holds the one the machine runs on.",
        );
      }
      this.log.info("App secret escrowed", {
        commandId: command.id,
        stored: result.stored,
        replaced: result.replaced,
      });
      return result;
    },
  });

  /**
   * The copy a `deploy` command deploys, by the lookups the secret set uses.
   * Undefined when no copy Lore knows matches; a refusal when the names
   * match two (another project's copy would be the answer), or when a
   * member's deploy row does not carry the command.
   */
  protected async deployedCopy(
    command: HostCommand,
  ): Promise<string | undefined> {
    if (command.payload.instanceId) {
      const member = await this.stackDeploys.memberInstanceFor(command);
      if (!member) {
        throw this.refused();
      }
      return member;
    }
    const matches = await this.instances.findMany({
      where: {
        hostId: { eq: command.hostId },
        app: { eq: command.payload.app },
        env: { eq: command.payload.environment },
      },
    });
    if (matches.length > 1) {
      this.log.warn(
        "App secret refused: the command names more than one copy",
        {
          commandId: command.id,
          matches: matches.length,
        },
      );
      throw this.refused();
    }
    return matches[0]?.id;
  }

  /**
   * Hex SHA-256 of a key, the form Bay compares.
   */
  protected async sha256(value: string): Promise<string> {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * `POST /estates/commands/:id/result`: the answer to a command whose
   * result is a payload rather than an ack.
   *
   * The protocol has no reply channel - a machine sends `hello`, `ack`,
   * `stats` and `inventory`, and none of them carries a body - so rather than
   * invent one, the answer goes over the seam that already has the right
   * shape: machine-facing, addressed by command id, host secret as bearer.
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
   * `FileJobs`, which is why `HostCommandJobs` learns nothing here and an
   * host deletion needs no blob hook.
   */
  /**
   * `GET /estates/commands/:id/registries`: the registry credentials of the
   * project whose stack this command deploys, opened, so the machine pulls
   * the stack's private images. Only for a `stack-deploy`, and only ever its
   * own project's: every other command is refused like an unknown one.
   */
  pullRegistries = $route({
    method: "GET",
    path: HostPullController.REGISTRIES_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      response: z.array(
        z.object({
          host: z.string(),
          username: z.string(),
          password: z.string(),
        }),
      ),
    },
    handler: async ({ params, headers, reply }) => {
      const command = await this.resolve(params.id, headers.authorization);
      reply.setHeader("cache-control", "no-store");
      const credentials = await this.stackDeploys.registriesFor(command);
      if (!credentials) {
        throw this.refused();
      }
      this.log.debug("Registry credentials pulled", {
        commandId: command.id,
        count: credentials.length,
      });
      return credentials;
    },
  });

  /**
   * `POST /estates/commands/:id/outcome`: what a `stack-deploy` did (the
   * revision applied, the plan, each service, the digests it pinned),
   * uploaded before the terminal ack, the way a `logs` result is.
   */
  pushOutcome = $route({
    method: "POST",
    path: HostPullController.OUTCOME_PATH,
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }),
      headers: z.object({ authorization: z.string().optional() }),
      body: stackDeployOutcomeSchema,
      response: z.object({ stored: z.boolean() }),
    },
    handler: async ({ params, headers, body }) => {
      const command = await this.resolve(params.id, headers.authorization);
      if (!(await this.stackDeploys.recordOutcome(command, body))) {
        throw this.refused();
      }
      return { stored: true };
    },
  });

  pushResult = $route({
    method: "POST",
    path: HostPullController.RESULT_PATH,
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
      const schema = HostPullController.RESULT_SCHEMAS[command.kind];
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
      if (bytes.byteLength > HostPullController.MAX_RESULT_BYTES) {
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
          bucket: HostPullController.RESULT_BUCKET,
          expirationDate: new Date(
            this.dateTime.nowMillis() +
              HostPullController.RESULT_TTL_HOURS * 3600_000,
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
   * The lookup is ONE query scoped on all three facts at once (id, host,
   * open state), so there is no path on which the id is found first and the
   * host checked second: a foreign command and an absent one are the same
   * empty result.
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
