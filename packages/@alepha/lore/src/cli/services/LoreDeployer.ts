import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import { ShellProvider } from "alepha/system";
import type { AppController } from "lore/api/controllers/AppController";
import type { DeployController } from "lore/api/controllers/DeployController";
import type { ProjectEstateController } from "lore/api/controllers/ProjectEstateController";

import {
  type LentEstate,
  LoreEstateChoice,
} from "../../client/services/LoreEstateChoice.ts";
import { LoreArtifactPusher } from "./LoreArtifactPusher.ts";
import { LoreClientService } from "./LoreClientService.ts";

/**
 * One deployed copy of an app, as the deploy path reads it.
 */
export interface LoreInstance {
  id: string;
  estateId?: string;
  ephemeral?: boolean;
  /**
   * The address Lore serves the copy at, once a deploy has given it one.
   */
  url?: string;
  /**
   * The name the estate knows the copy by.
   */
  resourceName?: string;
  /**
   * The tag of the copy's newest successful deploy: what it runs.
   */
  version?: string;
  estate?: { slug?: string; type?: string };
  updatedAt?: string;
}

/**
 * What a teardown removed, kept and failed to remove, in Lore's own words.
 */
export interface LoreDestroyResult {
  removed: string[];
  kept: string[];
  failed: Array<{ resource: string; message: string }>;
}

/**
 * The deploy path of the `lore` CLI, with no command in it: load the copy,
 * resolve the runtime its estate accepts, build and push, start a run and
 * follow it, and tear a copy down.
 *
 * ## ⚠️ Why this is a service and not the commands' bodies
 *
 * `lore deploy` and the platform adapter (`lore()` in `alepha.config.ts`) are
 * one deploy with two front doors. Left in `AppsCommand`, the adapter would
 * either reach into a command object or grow a second implementation, and two
 * deploys drift. The commands keep what is theirs: flag parsing, refusals worded
 * for a terminal, and output.
 *
 * ## ⚠️ The client never names an estate
 *
 * No estate id on the wire. It names a project, an app and an environment;
 * Lore resolves the rest from the `app_instances` row. A client that can name
 * its own estate can deploy into somebody else's cloud account - folio #96
 * named that hole, and `DeployGate` is the server half.
 *
 * ## ⚠️ Not `@alepha/lore/client`'s `LoreDeployService`
 *
 * That one is the Worker-safe client: path-addressed so its `.d.ts` names no
 * private type, `LORE_API_KEY` only, no token store and no log streaming. This
 * one keeps the typed `$client` and the laptop's login. Two clients with
 * different constraints is a known cost.
 */
export class LoreDeployer {
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
  protected readonly client = $inject(LoreClientService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly artifacts = $inject(LoreArtifactPusher);

  /**
   * ⚠️ Declared after `client`: a field initializer reading another field sees
   * `undefined` if that field is declared below it.
   */
  protected readonly apps = $client<AppController>(this.client.scope());
  protected readonly estates = $client<ProjectEstateController>(
    this.client.scope(),
  );
  protected readonly deploys = $client<DeployController>(this.client.scope());

  /**
   * The tag a build carries when nobody names one.
   *
   * `latest` is `ArtifactService.MUTABLE_TAG`: the one tag whose bytes may
   * change, and replacing it in place IS the retention policy. Every other tag
   * is write-once.
   */
  public static readonly DEFAULT_TAG = "latest";

  /**
   * The statuses a deploy run stops at, matching `deployments.status`.
   */
  protected static readonly TERMINAL = ["succeeded", "failed", "cancelled"];

  /**
   * How often the follower asks, and how long it is willing to wait.
   *
   * ⚠️ The timeout is a CLIENT giving up, never a deploy being cancelled. The
   * run keeps going server-side, so the message says where to look rather than
   * pretending anything was stopped.
   */
  protected static readonly POLL_INTERVAL_MS = 2_000;
  protected static readonly FOLLOW_TIMEOUT_MS = 15 * 60 * 1_000;

  /**
   * Which build target an artifact's runtime implies.
   *
   * ⚠️ **The `node` row is an inference, not a lookup.** A manifest carries a
   * RUNTIME and never a target, and `runtime: node` is producible by `bare`
   * and by `docker` alike. `bare` is chosen because epic #1 removed the
   * container and `buildManifest`'s own doc describes the node case as "spawn
   * a process against a directory with no entry point".
   * **If Bay ever consumes a docker image, this table is where that changes.**
   */
  public static readonly TARGET_FOR_RUNTIME: Record<string, string> = {
    workerd: "cloudflare",
    node: "bare",
    bun: "bare",
    static: "static",
  };

  /**
   * Which runtime each target asks `alepha build` for.
   *
   * ⚠️ **`alepha build` has no `--target` any more**: the build is described
   * by what it produces, so the CLI translates its own vocabulary into a
   * runtime on the way out. A TARGET names a deploy destination - an estate
   * type - which is a different question from which slice to link, and the
   * two only happen to line up one-to-one today.
   */
  public static readonly RUNTIME_FOR_TARGET: Record<string, string> = {
    cloudflare: "workerd",
    bare: "node",
    docker: "node",
    static: "static",
  };

  /**
   * The copy, read as it is: a 404 and every other failure are thrown as the
   * client raised them.
   */
  public async readInstance(
    projectId: number,
    app: string,
    env: string,
  ): Promise<LoreInstance> {
    return (await this.apps.getApp({
      params: { projectId, app, env },
    })) as LoreInstance;
  }

  /**
   * The copy, or `undefined` when Lore says there is none.
   *
   * ⚠️ Only a 404 is "none". An expired key, an unreachable Lore or a 403 are
   * different problems, rethrown, and must never be read as "missing" by a
   * caller that would create the copy on that answer.
   */
  public async findInstance(
    projectId: number,
    app: string,
    env: string,
  ): Promise<LoreInstance | undefined> {
    try {
      const instance = await this.readInstance(projectId, app, env);
      return instance?.id ? instance : undefined;
    } catch (error) {
      if (HttpError.is(error, 404)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The copy, or a refusal saying where to make one.
   *
   * ## ⚠️ A missing instance is refused, never created
   *
   * `app_instances` is unique on `(projectId, app, env)` and `AppService`
   * lowercases and pattern-checks each half, so `--env Production` normalises
   * onto an existing row while `--env prod` does not. The near-miss is the case
   * that matters: creating a deploy target as a side effect of a typo is how
   * `clbu` gets deployed to, and epic #30 accepted the typo cost precisely
   * because creation is always an explicit act.
   */
  public async loadInstance(
    projectId: number,
    app: string,
    env: string,
  ): Promise<LoreInstance> {
    const instance = await this.findInstance(projectId, app, env);
    if (instance) {
      return instance;
    }
    throw new AlephaError(
      `${app}/${env} is not a deployed copy of this project, so there is nowhere to deploy it. Create it on the project's Apps page, or with the \`app_instance_create\` MCP tool - naming one here would not make it exist.`,
    );
  }

  /**
   * Create the copy, on the estate the shared rule picks.
   *
   * ⚠️ `lore deploy` never calls this: its `--env` is free text, and a typo
   * there must not become a copy. A caller whose env names come from a
   * committed file (the platform adapter) may.
   *
   * Created with nothing optional: no domain (the estate owns the host), not
   * ephemeral (a copy made this way keeps its data, which `platform down`
   * relies on), and no sigil (the deploy mints one from the manifest). Two
   * calls, because `createApp` takes no estate: pointing the row at one is a
   * separate, validated act. The estate is chosen, and refused, before the
   * first call, so a bad `estate` creates nothing.
   */
  public async createInstance(
    projectId: number,
    app: string,
    env: string,
    estate?: string,
  ): Promise<LoreInstance> {
    const lent = await this.estates.listProjectEstates({
      params: { projectId },
    });
    const chosen = LoreEstateChoice.pick(
      (lent?.items ?? []) as LentEstate[],
      estate,
      `${app}/${env}`,
    );

    const created = (await this.apps.createApp({
      params: { projectId },
      body: { app, env },
    })) as LoreInstance & { app: string; env: string };
    const linked = (await this.apps.updateApp({
      params: { projectId, app: created.app, env: created.env },
      body: { estateId: chosen.id },
    })) as LoreInstance;

    // On its own line: a first deploy made something that outlives it.
    this.log.info(`Created ${app}/${env} on estate '${chosen.slug}'`);
    return linked;
  }

  /**
   * Every copy of every app in the project.
   */
  public async listInstances(
    projectId: number,
  ): Promise<Array<LoreInstance & { app: string; env: string }>> {
    const { items } = await this.apps.listApps({ params: { projectId } });
    return items as Array<LoreInstance & { app: string; env: string }>;
  }

  /**
   * The build target one copy implies.
   *
   * The chain needs no new column: `(project, app, env)` names an
   * `app_instances` row, its `estateId` names an estate, the estate's TYPE
   * decides the accepted runtimes, and the runtime decides the target.
   */
  public async targetForInstance(
    projectId: number,
    app: string,
    env: string,
    instance: { estateId?: string } | undefined,
  ): Promise<string> {
    if (!instance?.estateId) {
      // ⚠️ Refused, not fallen back on. Building every target for an
      // environment that names no estate produces bytes nobody asked for and
      // hides the real problem, which is that the copy has nowhere to deploy.
      throw new AlephaError(
        `${app}/${env} has no estate, so there is nothing to say what it can run. Choose one on its Settings tab, or pass --target.`,
      );
    }

    const lent = await this.estates.listProjectEstates({
      params: { projectId },
    });
    const estate = lent?.items?.find(
      (it: { id: string }) => it.id === instance.estateId,
    ) as { acceptedRuntimes?: string[]; type?: string } | undefined;
    const runtime = estate?.acceptedRuntimes?.[0];
    if (!runtime) {
      throw new AlephaError(
        `Could not tell what ${app}/${env} can run. Its estate is not lent to this project any more, or Lore did not say what it accepts.`,
      );
    }

    const target = LoreDeployer.TARGET_FOR_RUNTIME[runtime];
    if (!target) {
      throw new AlephaError(
        `${app}/${env} runs \`${runtime}\`, which this CLI has no build target for.`,
      );
    }
    return target;
  }

  /**
   * One `alepha build`, as a subprocess.
   *
   * ⚠️ **It runs `alepha build`. It does not reimplement it.** There is no
   * second build path to drift, because there is no second build path, and
   * Vite stays out of the `lore` binary's own graph.
   *
   * ⚠️ **No env-specific value is passed, ever.** The command line carries a
   * runtime and nothing else: that is what keeps two envs on one estate type
   * byte-identical, which is the property promotion depends on.
   *
   * ⚠️ **No target means a bare `alepha build`**, so the workspace's own
   * `build.runtime` decides. Passing a runtime there would override the config
   * with a guess.
   *
   * When a target IS named, its runtime is said out loud even where it matches
   * the default: a manifest naming the wrong one lands the push under the
   * wrong identity, and the artifact's `(app, tag, runtime)` key makes that a
   * silent overwrite rather than an error.
   *
   * `alepha` is how the `alepha` binary is invoked: `npx alepha` from the
   * `lore` binary, the running binary itself from inside `alepha platform`.
   */
  public async buildOnce(
    root: string,
    target: string,
    alepha = "npx alepha",
  ): Promise<void> {
    if (!target) {
      await this.shell.run(`${alepha} build`, { root });
      return;
    }
    const runtime = LoreDeployer.RUNTIME_FOR_TARGET[target] ?? "node";
    await this.shell.run(`${alepha} build --runtime ${runtime}`, { root });
  }

  /**
   * Build the target the copy's estate accepts, then push it.
   *
   * ⚠️ **It builds ONE target, straight into `dist/`.** `WorkspacePacker` tars
   * the whole of `dist/`, so anything else left in there rides inside the
   * artifact.
   */
  public async buildAndPush(input: {
    project: string;
    projectId: number;
    app: string;
    env: string;
    tag: string;
    root: string;
    run: RunnerMethod;
    instance: { estateId?: string };
    alepha?: string;
  }): Promise<void> {
    const target = await this.targetForInstance(
      input.projectId,
      input.app,
      input.env,
      input.instance,
    );

    await input.run({
      name: `build ${target}`,
      handler: async () => {
        await this.buildOnce(input.root, target, input.alepha);
      },
    });

    await this.artifacts.push({
      root: input.root,
      project: input.project,
      app: input.app,
      tag: input.tag,
      run: input.run,
    });
  }

  /**
   * Ask Lore to start a run.
   *
   * ⚠️ The body carries a tag and, when the operator overrode it, whether this
   * copy should have a sigil. It never carries an estate.
   *
   * ⚠️ `sigil` is forwarded ONLY when it was actually given. Absent is a
   * meaningful third state on the server - "do what the build declares" - so
   * sending `false` for an unset flag would silently disable that detection.
   */
  public async start(
    projectId: number,
    instanceId: string,
    tag: string,
    sigil?: boolean,
  ): Promise<{ id: string; status: string }> {
    try {
      return await this.deploys.startDeploy({
        params: { projectId, instanceId },
        body: { tag, ...(sigil === undefined ? {} : { sigil }) },
      });
    } catch (error) {
      // ⚠️ The reason in words, not a status code. Every refusal on this path
      // is written to be read by somebody who often cannot fix it themselves,
      // so the message is the deliverable.
      if (HttpError.is(error)) {
        throw new AlephaError(error.message);
      }
      throw error;
    }
  }

  /**
   * Follow one run, printing its log as it arrives.
   *
   * ⚠️ The log is the SERVER's, printed verbatim and never composed here: a
   * secret this process holds must not reach a record every member of the
   * project can read. It is bounded by `DeployRegistry.MAX_LOG_LINES`.
   */
  public async follow(
    projectId: number,
    deploymentId: string,
  ): Promise<{ status: string; error?: string; url?: string }> {
    const startedAt = this.dateTime.nowMillis();
    let printed = 0;

    for (;;) {
      const row = (await this.deploys.getDeployment({
        params: { projectId, deploymentId },
      })) as {
        status?: string;
        error?: string;
        url?: string;
        log?: Array<{ text: string }>;
      };

      const log = row?.log ?? [];
      for (const line of log.slice(printed)) {
        this.log.info(line.text);
      }
      printed = log.length;

      const status = row?.status ?? "";
      if (LoreDeployer.TERMINAL.includes(status)) {
        return { status, error: row?.error, url: row?.url };
      }

      if (
        this.dateTime.nowMillis() - startedAt >
        LoreDeployer.FOLLOW_TIMEOUT_MS
      ) {
        throw new AlephaError(
          `Stopped following deploy ${deploymentId} after 15 minutes. It is still running - watch it on the copy's Deploy tab.`,
        );
      }

      await this.dateTime.wait(LoreDeployer.POLL_INTERVAL_MS);
    }
  }

  /**
   * Remove the copy's Worker, queue and cache (and, for an ephemeral copy, its
   * database and bucket), confirmed by the copy's own `app/env`.
   *
   * ⚠️ Answers Lore's result as it is, `failed` included: whether a failed
   * resource is an error is the caller's to say, and both callers say it is.
   */
  public async destroy(
    projectId: number,
    app: string,
    env: string,
    confirm: string,
  ): Promise<LoreDestroyResult> {
    return (await this.apps.destroyAppResources({
      params: { projectId, app, env },
      body: { confirm },
    })) as LoreDestroyResult;
  }

  /**
   * Say what a teardown did, and fail on anything it could not do.
   *
   * The `kept` line is printed on every run: the point of a teardown that
   * keeps the data is that the data survives it, and an operator who assumes
   * otherwise will go looking for a backup that was never needed. A resource
   * in `failed` is an error, never swallowed, so a partial teardown exits
   * non-zero.
   */
  public report(result: LoreDestroyResult, label: string): void {
    this.log.info(
      result.removed.length > 0
        ? `Removed ${result.removed.join(", ")} for ${label}`
        : `Nothing left to remove for ${label}`,
    );
    if (result.kept.length > 0) {
      this.log.info(`Kept: ${result.kept.join(", ")}`);
    }
    for (const failure of result.failed) {
      this.log.warn(`${failure.resource} was not removed: ${failure.message}`);
    }
    if (result.failed.length > 0) {
      throw new AlephaError(
        `${result.failed.length} resource(s) could not be removed. What did go is no longer recorded, so running this again retries only the rest.`,
      );
    }
  }

  /**
   * What the operator is about to lose, in the refusal that asks them to
   * confirm.
   *
   * ⚠️ An **ephemeral** copy loses its database and its bucket, and that is the
   * one fact a person needs before typing the name. It is read rather than
   * assumed: the flag was set when the copy was created, possibly by somebody
   * else, possibly months ago.
   *
   * Best-effort. A read that fails must not stop somebody destroying a copy -
   * it just means the warning is the generic one.
   */
  public async destroyWarning(
    projectId: number,
    app: string,
    env: string,
  ): Promise<string> {
    try {
      const instance = await this.readInstance(projectId, app, env);
      return instance.ephemeral
        ? `\n\n⚠️  ${app}/${env} is EPHEMERAL: this also deletes its database and its bucket, and there is no backup.`
        : `\n\nIts database and bucket are kept; the Worker, queue and cache go.`;
    } catch {
      return "";
    }
  }
}
