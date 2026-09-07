import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { type Deployment, deployments } from "../entities/deployments.ts";
import { estates } from "../entities/estates.ts";
import { AppSecretService } from "./AppSecretService.ts";
import { ArtifactService } from "./ArtifactService.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { DeployGate } from "./DeployGate.ts";
import { DeployLimits } from "./DeployLimits.ts";
import { DeployRegistry } from "./DeployRegistry.ts";
import { DeployRunner } from "./DeployRunner.ts";
import { EstateService } from "./EstateService.ts";

/**
 * Starting a deploy, and running one.
 *
 * The two are separate on purpose. {@link queue} is what an HTTP request does:
 * check, write a row, hand the id back. {@link run} is what the job does, and
 * it can take tens of seconds.
 */
export class DeployService {
  protected readonly log = $logger();
  protected readonly rows = $repository(deployments);
  protected readonly instances = $repository(appInstances);
  protected readonly artifacts = $repository(artifacts);
  protected readonly estates = $repository(estates);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly secrets = $inject(AppSecretService);
  protected readonly gate = $inject(DeployGate);
  protected readonly limits = $inject(DeployLimits);
  protected readonly estateService = $inject(EstateService);
  protected readonly runner = $inject(DeployRunner);
  protected readonly registry = $inject(DeployRegistry);

  /**
   * Write the row a deploy will be followed through.
   *
   * ⚠️ **The snapshot is taken here**, at the moment of the request, and never
   * updated. Pushing `latest` replaces the artifact row, so a deployment
   * carrying only `artifactId` would start claiming it shipped bytes it never
   * saw.
   */
  public async queue(input: {
    projectId: number;
    instanceId: string;
    tag: string;
    createdBy?: string;
  }): Promise<Deployment> {
    const instance = await this.instances.findOne({
      where: {
        id: { eq: input.instanceId },
        projectId: { eq: input.projectId },
      },
    });
    if (!instance) {
      throw new NotFoundError("No such deployed copy in this project.");
    }
    // ⚠️ The same gate the run applies, here too. A queued row for a deploy
    // that can never run is a row somebody has to explain, and the caller is
    // holding a request that can carry the reason.
    const estate = await this.gate.assert(instance);

    // Every variant of this tag, because the refusal has to tell "wrong
    // variant" from "no variant at all" - `artifacts` is unique on
    // `(projectId, app, tag, runtime)`, so one tag names one row per runtime.
    const variants = await this.artifacts.findMany({
      where: {
        projectId: { eq: input.projectId },
        app: { eq: instance.app },
        tag: { eq: input.tag },
      },
    });

    // ⚠️ Pick the one this estate can RUN rather than the first row. A project
    // with a `node` and a `workerd` build of one tag is the multi-variant model
    // working, and taking whichever came back first would deploy the wrong one
    // half the time.
    const accepted = this.estateService.acceptedRuntimes(estate.type);
    const artifact =
      variants.find((it) => accepted.includes(it.runtime)) ?? variants[0];

    if (artifact) {
      // Last clause of the gate, and the only one that needed the artifact row.
      this.gate.assertRuntime({
        estate,
        app: instance.app,
        tag: input.tag,
        runtime: artifact.runtime,
        available: variants.map((it) => it.runtime),
      });
    }

    if (!artifact) {
      // ⚠️ Refused rather than built. The tag is what decides whether a deploy
      // builds, and this entry point can only ever deploy stored bytes: CI
      // pushed `0.28.0` on Tuesday from a clean checkout, and promoting it on
      // Friday must not rebuild it from a different machine.
      throw new NotFoundError(
        `${instance.app} has no artifact tagged '${input.tag}'. Push one with \`lore artifacts push\`, or deploy a tag that exists.`,
      );
    }

    return await this.rows.create({
      projectId: input.projectId,
      instanceId: instance.id,
      artifactId: artifact.id,
      app: artifact.app,
      tag: artifact.tag,
      sha256: artifact.sha256,
      status: "queued",
      createdBy: input.createdBy,
    });
  }

  /**
   * How many deploys this isolate is running right now.
   *
   * ⚠️ **In-memory, and per isolate, which is the honest scope.** The bound it
   * enforces is a 128 MB memory ceiling, and memory is per isolate: a counter
   * in D1 would be globally correct about a number that has no global meaning,
   * and would cost a write on both sides of every run to enforce it.
   *
   * A deploy that outlives its isolate is not double-counted either, because
   * the counter goes with it.
   */
  protected running = 0;

  /**
   * Run one queued deployment to a terminal state.
   *
   * ⚠️ **Every exit is terminal.** A row left `running` is a deploy the UI
   * follows forever and the operator cannot retry, so the catch is not
   * optional: it is the only thing that guarantees the row moves.
   */
  public async run(row: Deployment): Promise<void> {
    const cap = await this.limits.concurrency();
    if (this.running >= cap) {
      // ⚠️ Refused, not silently interleaved. A deploy holds an unpacked
      // artifact and its modules in memory against a ceiling shared with
      // everything else Lore is doing, so letting a third one in is an OOM
      // that takes the other two with it.
      //
      // The job's own retry is what makes this a queue rather than a loss: the
      // execution fails, is rescheduled with backoff, and lands when a slot is
      // free. The row stays `queued`, which is what the UI shows.
      throw new BadRequestError(
        `This Lore instance is already running ${cap} deploys. This one will start when a slot frees up.`,
      );
    }

    this.running++;
    try {
      const instance = await this.instances.findById(row.instanceId);
      if (!instance) {
        throw new BadRequestError(
          "The deployed copy this run was for is gone.",
        );
      }

      // ⚠️ **The gate, and every refusal in it, before any side effect.** One
      // owner: #1205's `DeployGate`. The estate comes back FROM it rather than
      // being resolved a second way, so nothing here can pass the gate and then
      // deploy somewhere else.
      const estate = await this.gate.assert(instance);

      if (!estate.accountId) {
        throw new BadRequestError(
          `The estate '${estate.slug}' names no Cloudflare account.`,
        );
      }
      if (!estate.credential) {
        throw new BadRequestError(
          `The estate '${estate.slug}' holds no credential to deploy with.`,
        );
      }

      const artifact = await this.artifacts.findOne({
        where: { projectId: { eq: row.projectId }, sha256: { eq: row.sha256 } },
      });
      if (artifact) {
        // ⚠️ Again here, not only at queue time. A row can sit queued while its
        // instance is pointed at a different estate, and a `node` build reaching
        // a Cloudflare Worker is a broken deploy after an upload rather than a
        // refusal before one.
        this.gate.assertRuntime({
          estate,
          app: row.app,
          tag: row.tag,
          runtime: artifact.runtime,
          available: [artifact.runtime],
        });
      }
      if (!artifact) {
        // The snapshot says what should ship and the bytes are gone - which is
        // what replacing `latest` does. Refusing names the fact rather than
        // deploying whatever now wears the tag.
        throw new NotFoundError(
          `The bytes this deployment names (${row.sha256.slice(0, 12)}) are no longer stored. Push ${row.app} ${row.tag} again.`,
        );
      }

      // ⚠️ A wedged deploy that holds a `$job` execution open forever is worse
      // than a failed one: the row stays `running`, the UI follows it, and the
      // operator cannot retry. The race is what makes the timeout terminal -
      // the run itself has no cancellation point to check.
      const result = await this.withTimeout(
        row,
        this.runner.run({
          artifact,
          env: instance.env,
          domain: instance.url ? new URL(instance.url).host : undefined,
          deploymentId: row.id,
          // ⚠️ Opened at the last possible moment, and NOT before the gate:
          // a run that is going to be refused must not decrypt anything.
          // `open` refuses the whole deploy if any row fails to open, because
          // a Worker shipped without one of its variables boots half
          // configured and fails as whatever that variable was holding
          // together.
          secrets: await this.secrets.open(instance.id),
          credential: {
            apiToken: this.seal.open(
              estate.credential,
              CredentialSealService.ESTATE_PURPOSE,
            ),
            accountId: estate.accountId,
          },
        }),
      );

      void result;
    } catch (error) {
      // `DeployRunner` already marks its own failures; this catches everything
      // that happens before it starts, and marking twice is harmless because
      // the second write lands on a row that is already terminal.
      const message = error instanceof Error ? error.message : String(error);
      await this.registry.failed(row.id, message);
      throw error instanceof AlephaError
        ? error
        : new AlephaError(`Deploy failed: ${message}`);
    } finally {
      this.running--;
    }
  }

  /**
   * The runs of one deployed copy, newest first.
   */
  public async list(
    projectId: number,
    instanceId: string,
    limit = 20,
  ): Promise<Deployment[]> {
    return await this.rows.findMany({
      where: {
        projectId: { eq: projectId },
        instanceId: { eq: instanceId },
      },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit,
    });
  }

  /**
   * The run, or a refusal once it has taken too long.
   *
   * ⚠️ The deploy is NOT cancelled - nothing in a fetch chain offers a
   * cancellation point this could reach, and abandoning a half-uploaded Worker
   * mid-flight would be worse than letting it finish. What the timeout
   * guarantees is that the ROW reaches a terminal state, which is what stops
   * the UI following a deploy forever.
   */
  protected async withTimeout<T>(
    row: Deployment,
    work: Promise<T>,
  ): Promise<T> {
    const ms = await this.limits.timeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AlephaError(
                  `This deploy took longer than ${Math.round(ms / 1000)}s and was abandoned. It may still be running at Cloudflare; check the Worker before retrying.`,
                ),
              ),
            ms,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * One run, scoped to the project that may read it.
   *
   * ⚠️ The `projectId` filter is the cross-project guard, not decoration: a
   * deployment id is a uuid a caller supplies, and the gate on the path param
   * has already passed by the time this runs.
   */
  public async find(
    projectId: number,
    deploymentId: string,
  ): Promise<Deployment | undefined> {
    return await this.rows.findOne({
      where: { projectId: { eq: projectId }, id: { eq: deploymentId } },
    });
  }

  /**
   * Kept beside {@link list} so a reader of one finds the other: what the
   * artifact registry calls a build, this table calls a run of it.
   */
  public static readonly ARTIFACT_BUCKET = ArtifactService.BUCKET;
}
