import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { type Artifact, artifacts } from "../entities/artifacts.ts";
import { type Deployment, deployments } from "../entities/deployments.ts";
import { estates } from "../entities/estates.ts";
import { projects } from "../entities/projects.ts";
import { AppSecretService } from "./AppSecretService.ts";
import { AppService } from "./AppService.ts";
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
  protected readonly projects = $repository(projects);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly secrets = $inject(AppSecretService);
  protected readonly apps = $inject(AppService);
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
    /**
     * Whether this copy should be given a sigil before it ships.
     *
     * Three states, and the middle one is the default: `true` mints one even
     * for a build that does not ask, `false` mints none, and **absent means
     * "do what the build declares"**.
     */
    sigil?: boolean;
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
    // `(projectId, app, tag, runtime, format)`, so one tag names one row per
    // runtime AND format.
    //
    // ⚠️ **Every variant, then partitioned here - never `format: archive` in
    // the WHERE.** Filtering in the query makes a tag whose only variant is an
    // image answer "has no artifact tagged", which is a lie to somebody who
    // just pushed one.
    const variants = await this.artifacts.findMany({
      where: {
        projectId: { eq: input.projectId },
        app: { eq: instance.app },
        tag: { eq: input.tag },
      },
    });
    const deployable = variants.filter((it) => it.format === "archive");
    const images = variants.filter((it) => it.format === "image");

    if (!deployable.length && images.length) {
      // Named rather than swallowed into "no artifact tagged": the tag exists,
      // and what it is is the whole answer.
      this.gate.assertDeployable({
        estate,
        app: instance.app,
        tag: input.tag,
        images: images.map((it) => it.reference),
      });
    }

    // ⚠️ Pick the one this estate can RUN rather than the first row. A project
    // with a `node` and a `workerd` build of one tag is the multi-variant model
    // working, and taking whichever came back first would deploy the wrong one
    // half the time.
    //
    // ⚠️ And only from `deployable`. An image row carries a real `runtime`, so
    // `acceptedRuntimes("bay")` being `["node"]` would happily select Lore's
    // own `node` IMAGE for a Bay deploy, which then fails downstream with no
    // useful message.
    const accepted = this.estateService.acceptedRuntimes(estate.type);
    const artifact =
      deployable.find((it) => accepted.includes(it.runtime)) ?? deployable[0];

    if (artifact) {
      // Last clause of the gate, and the only one that needed the artifact row.
      this.gate.assertRuntime({
        estate,
        app: instance.app,
        tag: input.tag,
        runtime: artifact.runtime,
        // Archive runtimes only, so this never reads "It has: node, node" and
        // never claims a `node` build for a tag whose only one is an image.
        available: deployable.map((it) => it.runtime),
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

    // ⚠️ Before the row, so a copy that cannot be given the sigil it asked for
    // is refused while the caller is still holding the request - rather than
    // failing inside a job, after an artifact has been fetched and unpacked.
    await this.maybeProvisionSigil(instance, artifact, input);

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
   * Run one queued deployment to a terminal state, or answer that this isolate
   * has no slot for it.
   *
   * ⚠️ **Every exit that starts is terminal.** A row left `running` is a
   * deploy the UI follows forever and the operator cannot retry, so the catch
   * is not optional: it is the only thing that guarantees the row moves.
   *
   * @returns `"busy"` when the isolate is already running its cap, having
   * touched nothing: no gate, no secret opened, no write. The row is still
   * `queued` and waiting is the caller's to arrange. `"done"` once the row is
   * terminal.
   */
  public async run(row: Deployment): Promise<"done" | "busy"> {
    const cap = await this.limits.concurrency();
    if (this.running >= cap) {
      // ⚠️ Turned away, not silently interleaved. A deploy holds an unpacked
      // artifact and its modules in memory against a ceiling shared with
      // everything else Lore is doing, so letting a third one in is an OOM
      // that takes the other two with it.
      //
      // ⚠️ Answered, NOT thrown. `lore.deploy.run` declares no retry, so a
      // throw here was the end of the execution: the row sat `queued` until
      // the sweep failed it as "stopped reporting". `DeployJobs.runDeploy`
      // reschedules on this answer instead, which is what makes the cap a
      // queue rather than a loss.
      return "busy";
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

      // ⚠️ `format: archive` here too, and not only at queue time. This looks
      // the row up on `sha256` alone, and an image's `sha256` is its index
      // digest - a different value from any tarball's - so a collision is not
      // the risk. The risk is the shape: this row is about to be handed to
      // `DeployRunner`, which fetches `artifact.fileId`, and an image has
      // none. Constraining the lookup means the miss below fires with its own
      // message rather than a null dereference two calls later.
      const artifact = await this.artifacts.findOne({
        where: {
          projectId: { eq: row.projectId },
          sha256: { eq: row.sha256 },
          format: { eq: "archive" },
        },
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

      const project = await this.projectSegmentOf(instance);

      // ⚠️ A wedged deploy that holds a `$job` execution open forever is worse
      // than a failed one: the row stays `running`, the UI follows it, and the
      // operator cannot retry. The race is what makes the timeout terminal -
      // the run itself has no cancellation point to check.
      const result = await this.withTimeout(
        row,
        this.runner.run({
          artifact,
          project,
          env: instance.env,
          domain: instance.url ? new URL(instance.url).host : undefined,
          deploymentId: row.id,
          // ⚠️ Opened at the last possible moment, and NOT before the gate:
          // a run that is going to be refused must not decrypt anything.
          // `open` refuses the whole deploy if any row fails to open, because
          // a Worker shipped without one of its variables boots half
          // configured and fails as whatever that variable was holding
          // together.
          secrets: await this.openSecrets(instance, project),
          credential: {
            apiToken: this.seal.open(
              estate.credential,
              CredentialSealService.ESTATE_PURPOSE,
            ),
            accountId: estate.accountId,
          },
        }),
      );

      // ⚠️ After the run and never before it: this records what the estate now
      // HOLDS, and a deploy that failed halfway may have created some of it.
      // The write is best-effort for the same reason - a copy that is live must
      // not be reported as failed because a bookkeeping update did not land.
      await this.recordResources(instance.id, result.resources);
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
    return "done";
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
  /**
   * The project segment of every resource name this copy provisions.
   *
   * Just the slug: the runner joins it to the app and `NamingService` joins
   * that to the environment, so the whole is `<project>-<app>-<env>`.
   *
   * ## ⚠️ Why the project is in the name at all
   *
   * `NamingService` composes `<name>-<env>`. With the app alone as the name,
   * two Lore projects that each call an app `api` and deploy `production` onto
   * one estate compute a single `api-production` - one Worker, one database,
   * one bucket, silently shared, each deploy overwriting the other and either
   * project's teardown taking the other's Worker down.
   *
   * ## ⚠️ A rename must never move a copy's infrastructure
   *
   * The slug moves when a project is renamed, and Cloudflare has no rename -
   * so a deploy under a new prefix would CREATE an empty database and leave
   * the old one behind, with the app coming up blank and nothing saying why.
   *
   * So the recorded Worker name wins whenever there is one: it IS the prefix
   * this copy was built under, and a deploy that would target a different one
   * is refused rather than silently re-pointed. The refusal names both, which
   * is the only way an operator can tell a rename from a bug.
   */
  protected async projectSegmentOf(instance: AppInstance): Promise<string> {
    const project = await this.projects.findById(instance.projectId);
    // `slug` is optional on the column; the id is the stable fallback the rest
    // of the app already uses when a title produces nothing sluggable.
    const slug = project?.slug || `project-${instance.projectId}`;

    const recorded = this.recordedWorker(instance);
    if (!recorded) {
      return slug;
    }

    const wanted = this.workerNameOf(slug, instance);
    if (recorded !== wanted) {
      throw new BadRequestError(
        `${instance.app}/${instance.env} was deployed as \`${recorded}\` and this deploy would target \`${wanted}\`. Cloudflare cannot rename, so deploying would create empty resources beside the ones this copy is using. Rename the project back, or destroy this copy and deploy it again to move it deliberately.`,
      );
    }
    return slug;
  }

  /**
   * The Worker name this copy deploys under, `<project>-<app>-<env>`.
   *
   * ⚠️ The full name the runner and `NamingService` will compose between
   * them: the runner joins the project segment to the app, and
   * `NamingService` joins that to the env. Restated here so a comparison is
   * against what will actually be created, not against a piece of it.
   */
  protected workerNameOf(project: string, instance: AppInstance): string {
    return this.slugify(`${project}-${instance.app}-${instance.env}`);
  }

  /**
   * The Worker name a previous deploy recorded, when there was one.
   */
  protected recordedWorker(instance: AppInstance): string | undefined {
    if (!instance.resources) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(instance.resources) as { worker?: string };
      return parsed.worker;
    } catch {
      return undefined;
    }
  }

  /**
   * ⚠️ Must match `NamingService.slugify`, which is what actually names the
   * resources. It lives in `alepha/cli/platform-lib` beside a class that pulls
   * a Cloudflare client in, so it is restated rather than imported - and the
   * 63-character slice is part of the contract, not a detail.
   */
  protected slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  }

  /**
   * Remember what the estate now holds for this copy.
   *
   * ⚠️ **This is the only record there will ever be.** The names are derived
   * from `(project, env)` and so are reproducible, but an estate is LENT: the
   * account holds resources Lore never created, and a teardown that recomputed
   * a name would be willing to delete one of them. What Lore may remove is
   * exactly what it can show it made.
   *
   * Best-effort, and deliberately so: the deploy has already succeeded by the
   * time this runs, and reporting a live copy as failed because a bookkeeping
   * write did not land would be the worse error. The cost of losing it is that
   * a later teardown refuses rather than guessing.
   */
  protected async recordResources(
    instanceId: string,
    resources: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!resources || Object.keys(resources).length === 0) {
      return;
    }
    try {
      await this.instances.updateById(instanceId, {
        resources: JSON.stringify(resources),
      });
    } catch (error) {
      this.log.warn("Could not record what this deploy provisioned", {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Give this copy a sigil when the build it is about to run asks for one.
   *
   * ## The build's own declaration is the trigger
   *
   * An app that bundles the reporting module declares `SIGIL_KEY` through
   * `$env`, and `alepha build` writes every declared key into the manifest -
   * which the registry read out of the tarball at push and stored. So "does
   * this build report to Lore" is a question the artifact already answers, and
   * asking an operator to answer it again with a flag is how copies end up
   * deployed with telemetry silently off.
   *
   * ⚠️ **An absent manifest means UNKNOWN, so it mints nothing.** Every
   * artifact pushed before that column existed has none, and reading absence
   * as "declares nothing" is right here only because this method exists to ADD
   * behaviour: the worst a null does is leave a copy as it would have been.
   *
   * ## Three states, and the failure modes differ
   *
   * `false` mints nothing, for a copy that should stay quiet. `true` is the
   * operator overriding the build, and it is allowed to FAIL the deploy: they
   * asked for something Lore cannot always do, and the refusal has to reach
   * them. Absent is the automatic path, which never throws - a copy whose
   * sigil is managed by hand must not stop deploying because Lore could not
   * store a key it was never asked to store.
   */
  protected async maybeProvisionSigil(
    instance: AppInstance,
    artifact: Artifact,
    input: { sigil?: boolean; createdBy?: string },
  ): Promise<void> {
    if (input.sigil === false) {
      return;
    }

    if (input.sigil === true) {
      await this.apps.provisionSigil(
        instance,
        input.createdBy ? { createdBy: input.createdBy } : {},
      );
      return;
    }

    // Automatic from here down: nothing below may throw.
    if (instance.sigilId || !this.declaresSigil(artifact)) {
      return;
    }

    try {
      await this.apps.provisionSigil(
        instance,
        input.createdBy ? { createdBy: input.createdBy } : {},
      );
    } catch (error) {
      // A deploy that would otherwise have shipped must not be lost to this.
      // The copy simply runs without reporting, which is the state it was
      // already in.
      this.log.warn(
        `Could not mint a sigil for ${instance.app}/${instance.env}; deploying without one`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Whether this build declares the variable the reporting module reads.
   *
   * ⚠️ Defensive on every step. The column holds whatever a past push stored
   * under a `.loose()` schema, so it may be absent, may not parse, and may not
   * have the shape this expects - and none of those is a reason to fail a
   * deploy. Anything unreadable is "does not declare", which mints nothing.
   */
  protected declaresSigil(artifact: Artifact): boolean {
    if (!artifact.manifest) {
      return false;
    }
    try {
      const parsed = JSON.parse(artifact.manifest) as { env?: unknown };
      return (
        Array.isArray(parsed.env) && parsed.env.includes(AppService.SIGIL_KEY)
      );
    } catch {
      return false;
    }
  }

  /**
   * The copy's variables, filling in the ones no operator should have to.
   *
   * ⚠️ **Before `open`, and only ever adding what is missing.** Every Alepha
   * app refuses to boot in production without `APP_SECRET`, and that refusal
   * lands AFTER D1 and R2 are provisioned and the migrations are applied - so
   * a copy nobody set one on deployed "successfully" and then answered 500,
   * five layers from the cause. `ensureGenerated` writes the row once and
   * leaves an existing value alone, so an operator who set their own keeps it.
   *
   * {@link APP_NAME} is filled the same way, on a first deploy only.
   */
  protected async openSecrets(
    instance: AppInstance,
    project: string,
  ): Promise<Record<string, string>> {
    await this.secrets.ensureGenerated(instance.id);
    if (!(await this.hasBeenDeployed(instance))) {
      await this.secrets.ensureDefault(
        instance.id,
        DeployService.APP_NAME,
        this.workerNameOf(project, instance),
      );
    }
    return await this.secrets.open(instance.id);
  }

  /**
   * The name a copy is given on its first deploy: its Worker name,
   * `<project>-<app>-<env>`, so it reads the same in its own logs, in the
   * Cloudflare dashboard and in Lore. Bay gives its instances `<app>-<env>`
   * the same way.
   *
   * ## ⚠️ A default, and stored
   *
   * `APP_NAME` is more than a log label: it prefixes the session cookie, and
   * it is the key prefix of the copy's bucket when `S3_KEY_PREFIX` is unset.
   * So it is durable state, like `APP_SECRET` - written once and read on every
   * deploy after, never recomputed. A value on the Environment tab wins, and so
   * does one the app declares in code, which the framework keeps over anything
   * the environment says.
   *
   * ## ⚠️ Never given to a copy that has already been deployed
   *
   * Such a copy may hold objects at the root of its bucket, and a prefix
   * appearing under it would make every one of them 404, with nothing
   * reporting it - on top of signing every user out once. An operator can
   * still set it on the Environment tab, knowing that. Deleting the stored
   * value is how a copy opts out: a copy that has deployed is never given it
   * again.
   */
  public static readonly APP_NAME = "APP_NAME";

  /**
   * Whether this copy has ever gone live.
   *
   * Two signals, because both are written best-effort after a successful run
   * ({@link recordResources} and `DeployRegistry.succeeded` each swallow a
   * failed write), so either can be missing from a copy that is live. Asking
   * both means a copy is misread as new only when both writes were lost.
   */
  protected async hasBeenDeployed(instance: AppInstance): Promise<boolean> {
    if (this.recordedWorker(instance)) {
      return true;
    }
    const succeeded = await this.rows.findOne({
      where: {
        instanceId: { eq: instance.id },
        status: { eq: "succeeded" },
      },
    });
    return !!succeeded;
  }

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
