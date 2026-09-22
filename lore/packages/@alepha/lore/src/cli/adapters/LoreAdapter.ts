import { $inject, $store, AlephaError } from "alepha";
import {
  EXCLUDED_SECRET_KEYS,
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
  platformOptions,
  resolveSecretKeySet,
  selectSecrets,
} from "alepha/cli/platform-lib";
import { EnvUtils, type RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import {
  type LoreEnvironmentOptions,
  loreEnvironmentOptionsSchema,
} from "../schemas/loreEnvironmentOptions.ts";
import { LoreArtifactPusher } from "../services/LoreArtifactPusher.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreDeployer, type LoreInstance } from "../services/LoreDeployer.ts";
import { LoreDeviceLogin } from "../services/LoreDeviceLogin.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreSecretsService } from "../services/LoreSecretsService.ts";

/**
 * `alepha platform` deploying through Lore: an environment written
 * `lore({ project })` in `alepha.config.ts`.
 *
 * It fits the pipeline every adapter runs - authenticate, provision, build,
 * migrate, deploy, secrets - the way the Cloudflare and Bay adapters do, with
 * its secrets riding the deploy. What differs is where the work happens: the
 * machine builds and pushes an artifact, and Lore places it, on the estate the
 * copy is lent, with the secrets Lore keeps sealed.
 *
 * ## ⚠️ One deploy, two front doors
 *
 * Every step is a {@link LoreDeployer} (or {@link LoreSecretsService}) call,
 * the same services `lore deploy` runs. This class is the order they go in and
 * nothing else, so the two cannot drift.
 *
 * ## ⚠️ No promotion here
 *
 * `up` always builds what is in the working tree and places it, as `latest`.
 * Deploying a stored tag without building is `lore deploy --tag`, and stays
 * there.
 *
 * ## ⚠️ Declared in `AlephaLoreDeploy`, never beside the commands
 *
 * `platform()` registers this class when the config loads, which registers the
 * module declaring it. That module is services-only, so the `alepha` binary
 * gains an adapter and not a single `lore` verb.
 */
export class LoreAdapter extends PlatformAdapter<LoreEnvironmentOptions> {
  static readonly id = "lore";
  static readonly options = loreEnvironmentOptionsSchema;

  /**
   * `false`: the estate owns the host, not `alepha.config.ts`. `up` reports
   * the URL Lore answers the run with instead.
   */
  override readonly controlsDomain = false;

  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly deployer = $inject(LoreDeployer);
  protected readonly artifacts = $inject(LoreArtifactPusher);
  protected readonly sealed = $inject(LoreSecretsService);
  protected readonly device = $inject(LoreDeviceLogin);
  protected readonly platform = $store(platformOptions);

  /**
   * The tag `up` builds and pushes: the mutable one. A pinned tag is a
   * release, and a release is cut and promoted with `lore`, not rebuilt here.
   */
  public static readonly TAG = "latest";

  /**
   * Each environment's resolved project id and copy, found by `provision` and
   * read by `build` and `deploy`. Keyed by project, app and env, so two
   * environments in one run never share an entry.
   */
  protected readonly targets = new Map<
    string,
    { project: string; projectId: number; instance: LoreInstance }
  >();

  /**
   * Never prompts: `up` runs in CI. `LORE_API_KEY`, else the stored login,
   * refreshed if it expired, else an error naming both fixes.
   */
  async authenticate(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    _run: RunnerMethod,
  ): Promise<void> {
    this.configure(ctx);
    await this.client.authorization();
  }

  /**
   * The device-code flow `lore login` runs, against this environment's Lore.
   */
  override async login(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    _run: RunnerMethod,
  ): Promise<void> {
    this.configure(ctx);
    await this.device.login();
  }

  override async logout(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    _run: RunnerMethod,
  ): Promise<void> {
    this.configure(ctx);
    await this.device.logout();
  }

  /**
   * Find the copy this environment deploys to, before anything is built.
   *
   * A copy that does not exist is refused, by the same message `lore deploy`
   * gives.
   */
  override async provision(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    _run: RunnerMethod,
  ): Promise<void> {
    await this.target(ctx);
  }

  /**
   * Build the runtime the copy's estate accepts, then push it as `latest`.
   *
   * The build is `alepha build` run by THIS binary as a subprocess, never
   * `npx alepha` (which could resolve a different version) and never a
   * reimplementation. With `--prebuilt`, `dist/` is already what ships, so
   * only the push runs.
   */
  async build(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    const { project, projectId, instance } = await this.target(ctx);
    if (ctx.prebuilt) {
      await this.artifacts.push({
        root: ctx.root,
        project,
        app: ctx.project,
        tag: LoreAdapter.TAG,
        run,
      });
      return;
    }
    await this.deployer.buildAndPush({
      project,
      projectId,
      app: ctx.project,
      env: ctx.env,
      tag: LoreAdapter.TAG,
      root: ctx.root,
      run,
      instance,
      alepha: this.alephaCommand(),
    });
  }

  /**
   * Push the secrets, then start the run and follow it to its end.
   *
   * ⚠️ Secrets first, and a refused one stops the deploy before the run
   * starts: a build that boots without a secret it needs fails at boot, where
   * the reason is much harder to read.
   */
  async deploy(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    const { projectId, instance } = await this.target(ctx);
    const label = `${ctx.project}/${ctx.env}`;

    await run({
      name: `seal secrets for ${label}`,
      handler: async () => {
        await this.pushSecrets(ctx, projectId, instance.id);
      },
    });

    let url: string | undefined;
    await run({
      name: `deploy ${label}`,
      handler: async () => {
        const started = await this.deployer.start(
          projectId,
          instance.id,
          LoreAdapter.TAG,
        );
        const finished = await this.deployer.follow(projectId, started.id);
        if (finished.status !== "succeeded") {
          throw new AlephaError(
            finished.error ||
              `The deploy of ${ctx.project}@${LoreAdapter.TAG} to ${label} ended ${finished.status}.`,
          );
        }
        url = finished.url;
      },
    });
    return url;
  }

  /**
   * Nothing to do here, and that is deliberate rather than missing: the
   * secrets went into Lore in {@link deploy}, before the run started. Pushing
   * them after the run would boot the new build without them.
   */
  override async secrets(
    _ctx: PlatformContext<LoreEnvironmentOptions>,
    _run: RunnerMethod,
  ): Promise<void> {}

  async inspect(
    _ctx: PlatformContext<LoreEnvironmentOptions>,
    _run: RunnerMethod,
  ): Promise<PlatformState> {
    throw new AlephaError(
      "`alepha platform status` does not read a Lore environment yet. Use the copy's page in Lore.",
    );
  }

  async teardown(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    _run: RunnerMethod,
  ): Promise<void> {
    throw new AlephaError(
      `\`alepha platform down\` does not tear down a Lore environment yet. Run \`lore apps destroy --app ${ctx.project} --env ${ctx.env} --confirm ${ctx.project}/${ctx.env}\`.`,
    );
  }

  /**
   * The project, and the origin applied, for this environment.
   *
   * `LORE_PROJECT` and `LORE_URL` win over the config, so CI needs no edit to a
   * committed file.
   */
  protected configure(ctx: PlatformContext<LoreEnvironmentOptions>): string {
    this.client.useUrl(ctx.options.url);
    const project = this.client.projectFromEnv() ?? ctx.options.project;
    if (!project) {
      throw new AlephaError(
        `Environment "${ctx.env}" names no Lore project. Write lore({ project: "<slug>" }) in alepha.config.ts, or set LORE_PROJECT.`,
      );
    }
    return project;
  }

  /**
   * This environment's project id and copy, resolved once per run.
   */
  protected async target(
    ctx: PlatformContext<LoreEnvironmentOptions>,
  ): Promise<{ project: string; projectId: number; instance: LoreInstance }> {
    const project = this.configure(ctx);
    const key = `${project}\u0000${ctx.project}\u0000${ctx.env}`;
    const known = this.targets.get(key);
    if (known) {
      return known;
    }
    const projectId = await this.projects.resolve(project);
    const instance = await this.deployer.loadInstance(
      projectId,
      ctx.project,
      ctx.env,
    );
    const target = { project, projectId, instance };
    this.targets.set(key, target);
    return target;
  }

  /**
   * The app's secrets into the copy's sealed set.
   *
   * The key set is the one every adapter resolves (`resolveSecretKeySet`):
   * `platform().secrets.keys`, else the manifest's `env` (or the `.env.<env>`
   * keys) plus the `.env.<env>.local` keys, each value from the file first and
   * then `process.env`. Additive: a key Lore holds that this set lacks is left
   * alone. `SIGIL_KEY` is never written, and a name Lore reserves is dropped
   * here rather than refused there.
   *
   * Known cost, accepted: a stale local `.env.<env>` can overwrite a value set
   * in the Lore UI. The alternative is worse: a repository moving from
   * `cloudflare()` to `lore()` would deploy with no secrets and fail at boot.
   */
  protected async pushSecrets(
    ctx: PlatformContext<LoreEnvironmentOptions>,
    projectId: number,
    instanceId: string,
  ): Promise<void> {
    const { keys, envVars } = await resolveSecretKeySet({
      fs: this.fs,
      envUtils: this.envUtils,
      root: ctx.root,
      env: ctx.env,
      keys: this.platform?.secrets?.keys,
    });
    const { secrets } = selectSecrets({
      keys,
      envVars,
      excluded: EXCLUDED_SECRET_KEYS,
    });
    const pairs = this.sealed.importable(secrets, `.env.${ctx.env}`, {
      reserved: EXCLUDED_SECRET_KEYS,
    });
    if (pairs.length === 0) {
      this.log.info(
        `No secret to seal for ${ctx.project}/${ctx.env}; Lore keeps what it has.`,
      );
      return;
    }

    const { set, refused } = await this.sealed.push(
      { projectId, instanceId },
      pairs,
    );
    this.log.info(
      `Sealed ${set.length} secret${set.length === 1 ? "" : "s"} for ${ctx.project}/${ctx.env}: ${set.join(", ")}`,
    );
    if (refused.length > 0) {
      throw new AlephaError(
        `Lore refused ${refused.length} secret(s), so nothing was deployed: ${refused.join("; ")}`,
      );
    }
  }

  /**
   * How to run the `alepha` binary that is running now: its runtime and its
   * entry script, quoted for the shell.
   */
  protected alephaCommand(): string {
    const quote = (it: string) => JSON.stringify(it);
    const script = process.argv[1];
    return script
      ? `${quote(process.execPath)} ${quote(script)}`
      : quote(process.execPath);
  }
}
