import { $inject, AlephaError, z } from "alepha";
import { $command, type CommandHandlerArgs } from "alepha/command";
import { $logger } from "alepha/logger";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreDeployer } from "../services/LoreDeployer.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore apps build` and `lore deploy` - produce the bytes, and place them.
 *
 * ```bash
 * lore deploy                 # build, push, deploy
 * lore deploy --tag 0.28.0    # deploy the stored artifact, NO build
 * ```
 *
 * `deploy` is registered twice, at the top level and under `apps`, over one
 * flags schema and one handler - see {@link deployCommand}.
 *
 * The deploy itself - loading the copy, resolving its runtime, building,
 * pushing, starting and following, tearing down - is {@link LoreDeployer},
 * shared with the platform adapter so there is one deploy with two front doors.
 * This command keeps what is its own: flags, refusals worded for a terminal,
 * and output.
 *
 * ## ⚠️ The tag is the switch, and that is what makes the registry real
 *
 * An unconditional cascade - deploy always builds - would make the artifact
 * registry decorative. CI pushed `0.28.0` on Tuesday from a clean checkout, it
 * passed staging, and on Friday it is promoted. Rebuilding at that moment
 * produces different bytes, from a different machine, with a different
 * `node_modules`, shipped under a name that claims to be the thing that was
 * tested. So a named tag deploys what is stored and **refuses when it does not
 * exist**, rather than quietly building one.
 *
 * ## ⚠️ `--env` is on `deploy` and NOT on `build`, deliberately
 *
 * On `build` it selects a TARGET (which runtime the estate behind that env
 * accepts) and never reaches a value inside the bytes. On `deploy` it names the
 * **instance**: a deploy axis rather than a build axis. So the zero-flag
 * command builds env-independent bytes and then places them at an env, and
 * `lore apps build --env staging` is a legal thing to type that means something
 * narrower than it looks. That asymmetry is worth one sentence in `--help`.
 *
 * ## ⚠️ The client never names an estate
 *
 * No `--estate` flag, no estate id on the wire. It names a project, an app and
 * an environment; Lore resolves the rest from the `app_instances` row. A client
 * that can name its own estate can deploy into somebody else's cloud account -
 * folio #96 named that hole, and `DeployGate` is the server half.
 *
 * ## ⚠️ Why the client builds at all
 *
 * Lore's Worker cannot run Vite. Lore absorbs `alepha platform`, never `alepha
 * build`, so the artifact is always produced on the machine holding the source.
 *
 * ## ⚠️ It runs `alepha build`. It does not reimplement it.
 *
 * The build is a subprocess of the real `alepha` binary, one per target. That
 * is deliberate and it is the strongest possible reading of "reuse the
 * pipeline": there is no second build path to drift, because there is no second
 * build path. `BuildCommand` is 350 lines of ordering over ten tasks, a Vite
 * boot and a meta resolution, and a copy of that in this package would be worse
 * than no command.
 *
 * It also keeps Vite out of the `lore` binary's own graph, which is the reason
 * `alepha/cli`'s barrel cannot simply be imported here.
 *
 * What this command owns is everything around the build: which targets, where
 * the outputs go, and what tags them.
 *
 * ## ⚠️ `--env` selects a TARGET. It never reaches a value inside the build.
 *
 * An app's environments can want different runtimes - one on a Cloudflare
 * estate, one on a Bay machine - so `--env` says "build the thing that env can
 * run" without the operator having to remember which estate is behind it.
 *
 * That is safe because **`runtime` is part of the artifact's identity**:
 * `artifacts` is unique on `(projectId, app, tag, runtime)`, so `docs@0.28.0`
 * built for a Cloudflare env and for a Bay env are two rows rather than a
 * collision, and a deploy is a lookup on the runtime the estate accepts.
 *
 * ⚠️ What it must never do is thread an env-specific VALUE into the bytes. Not
 * `DATABASE_URL`, not `R2_BUCKET_NAME`, not a secret. Folio #1209: a cloudflare
 * build with no `DATABASE_URL` emits a config with no bindings, and that is
 * correct, because they are regenerated at deploy time from the manifest plus
 * freshly provisioned ids. The test that separates the two is in
 * `AppsCommand.spec.ts`: **two envs on the same estate type must produce
 * byte-identical output.** If they do not, this flag has become the thing it
 * must not be and promotion across environments is broken.
 *
 * ## ⚠️ The target LIST is local, and Lore has nothing to read
 *
 * Since epic #30 there is no `apps` table: an app is `GROUP BY app` over
 * `app_instances`, whose columns are `projectId`, `app`, `env`, `sigilId`,
 * `estateId` and `createdBy`. Not one says anything about build targets. The
 * build already parses `alepha.config.ts` for everything else and runs on the
 * machine that holds it, and a build must work offline - pushing is a separate
 * step. So a target the local config does not declare cannot be built, whatever
 * Lore holds.
 *
 * ⚠️ **`--env` is a remote read; `--target` is not.** Naming an env names a
 * row, so resolving it needs Lore. `lore apps build` with neither flag builds
 * what the local config declares, with no network at all.
 *
 * ## ⚠️ On `deploy`, an OMITTED `--env` is a remote read too
 *
 * `LoreProjectResolver.resolveEnv` asks Lore which copies of this app exist and
 * takes the single one, refusing when there are several. So the bare `lore
 * deploy` costs one extra request and none when `--env` is given.
 *
 * That is only true of `deploy`. `build`'s `--env` selects a build target
 * rather than a copy, and `destroy` refuses to fall back at all - see the note
 * on its handler.
 */
export class AppsCommand {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly deployer = $inject(LoreDeployer);

  /**
   * The tag a build carries when nobody names one: `latest`, the one tag
   * whose bytes may change. See {@link LoreDeployer.DEFAULT_TAG}.
   */
  public static readonly DEFAULT_TAG = LoreDeployer.DEFAULT_TAG;

  public readonly build = $command({
    name: "build",
    description: "Build this app for one or more deploy targets",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT. Only read when --env is given.",
        })
        .optional(),
      app: z
        .text({
          description:
            "App name. Defaults to the slugified `name` from package.json.",
        })
        .optional(),
      tag: z
        .text({
          aliases: ["t"],
          description:
            "Version these bytes are named by. Defaults to `latest`, the one tag that may be replaced.",
        })
        .optional(),
      target: z
        .text({
          description:
            "Build target, or several separated by commas. Omitted, the local alepha.config.ts decides.",
        })
        .optional(),
      env: z
        .text({
          aliases: ["e"],
          description:
            "Build what this environment can run. Resolved through its estate; never threaded into the bytes.",
        })
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const app = await this.projects.resolveApp(flags.app, root);
      const tag = flags.tag ?? AppsCommand.DEFAULT_TAG;
      const targets = await this.resolveTargets(flags, root);

      for (const target of targets) {
        await run({
          name: `build ${target || "(config)"} → dist/`,
          handler: async () => {
            await this.deployer.buildOnce(root, target);
          },
        });
      }

      this.log.info(`Built ${targets.length} target(s) for ${app} ${tag}`, {
        targets,
      });

      // ⚠️ Every build starts by cleaning `dist/`, so after several targets
      // only the last one is still on disk - and `lore artifacts push` packs
      // `dist/`. Saying which one survived is the difference between pushing
      // the target you meant and pushing the one that happened to be last.
      if (targets.length > 1) {
        this.log.info(
          `dist/ holds \`${targets.at(-1) || "(config)"}\`. A push takes that one; build and push a target at a time to store the others.`,
        );
      }
    },
  });

  public readonly destroy = $command({
    name: "destroy",
    description:
      "Delete the Worker, queue and cache; the database and bucket are kept",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "Lore project slug, overriding LORE_PROJECT.",
        })
        .optional(),
      app: z
        .text({
          description:
            "App name. Defaults to the slugified `name` from package.json.",
        })
        .optional(),
      env: z
        .text({
          aliases: ["e"],
          description:
            "Which deployed copy. ⚠️ Required here, unlike every other command: this one does not fall back to LORE_ENV, nor to the app's own rows when it has only one.",
        })
        .optional(),
      confirm: z
        .text({
          description:
            "The copy's own `app/env`, typed. A wrong --env then fails this check instead of destroying the wrong copy.",
        })
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);
      const app = await this.projects.resolveApp(flags.app, root);

      // ⚠️ `flags.env` directly, NEVER `resolveEnv`. On deploy an omitted
      // `--env` falls back to LORE_ENV and then to the app's own rows, taking
      // the single one when there is exactly one - which for most apps IS
      // production. On a command that deletes things, that turns a forgotten
      // flag into "destroy production", and the word never appears on screen.
      const env = flags.env?.trim();
      if (!env) {
        throw new AlephaError(
          `Name the copy with --env. This command does not fall back to LORE_ENV, and it does not take an app's only environment the way \`deploy\` does, because a forgotten flag would mean destroying production without either of us typing the word.`,
        );
      }

      // ⚠️ The confirmation is TYPED, not derived. Composing it here would
      // make the server's check tautological: a wrong `--env` would confirm
      // itself and destroy a copy the operator never named. Typed, a wrong
      // `--env` fails the check instead.
      const expected = `${app}/${env}`;
      if (flags.confirm?.trim() !== expected) {
        throw new AlephaError(
          `Pass --confirm "${expected}" to destroy it.${await this.deployer.destroyWarning(projectId, app, env)}`,
        );
      }

      const result = await this.deployer.destroy(
        projectId,
        app,
        env,
        flags.confirm.trim(),
      );

      this.log.info(
        result.removed.length > 0
          ? `Removed ${result.removed.join(", ")} for ${app}/${env}`
          : `Nothing left to remove for ${app}/${env}`,
      );
      if (result.kept.length > 0) {
        // Said out loud on every run: the point of this command is that the
        // data survives it, and an operator who assumes otherwise will go
        // looking for a backup that was never needed.
        this.log.info(`Kept: ${result.kept.join(", ")}`);
      }
      for (const failure of result.failed) {
        this.log.warn(
          `${failure.resource} was not removed: ${failure.message}`,
        );
      }
      if (result.failed.length > 0) {
        throw new AlephaError(
          `${result.failed.length} resource(s) could not be removed. What did go is no longer recorded, so running this again retries only the rest.`,
        );
      }
    },
  });

  /**
   * The deploy flags, declared once and handed to BOTH primitives below.
   *
   * A static rather than two literals, because two `$command`s that mean the
   * same thing must not be able to drift into two different `--help` outputs
   * or two different alias sets. Statics are initialized before any instance
   * field, so a field initializer may read this whatever its position.
   */
  protected static readonly DEPLOY_FLAGS = z.object({
    project: z
      .text({
        aliases: ["p"],
        description: "Lore project slug, overriding LORE_PROJECT.",
      })
      .optional(),
    app: z
      .text({
        description:
          "App name. Defaults to the slugified `name` from package.json.",
      })
      .optional(),
    tag: z
      .text({
        aliases: ["t"],
        description:
          "Deploy the stored build under this tag, without building. Omitted, this builds and pushes first.",
      })
      .optional(),
    env: z
      .text({
        aliases: ["e"],
        description:
          "Which deployed copy to place it on. Unlike `apps build`, this names the instance, not a target. Falls back to LORE_ENV, then to the app's own rows when it has exactly one.",
      })
      .optional(),
    sigil: z
      .boolean()
      .describe(
        "Force a sigil for this copy, storing its key in the copy's own environment. Unneeded for a build that declares SIGIL_KEY: that is detected and done for you. `--no-sigil` opts out.",
      )
      .optional(),
  });

  protected static readonly DEPLOY_DESCRIPTION =
    "Deploy this app onto one of its environments";

  public readonly deploy = $command({
    name: "deploy",
    description: AppsCommand.DEPLOY_DESCRIPTION,
    flags: AppsCommand.DEPLOY_FLAGS,
    handler: (args) => this.runDeploy(args),
  });

  /**
   * `lore deploy`, the same command one word shorter.
   *
   * A second primitive over {@link DEPLOY_FLAGS} and {@link runDeploy}, so
   * there is one flags schema and one handler body and nothing to drift.
   * `lore apps deploy` keeps working: `resolveCommand` matches the first word
   * against TOP-LEVEL commands only, and {@link deploy} is a child of `apps`,
   * so `deploy` reaches this one and the child stays reachable underneath its
   * parent.
   *
   * ## ⚠️ Only `deploy` is promoted
   *
   * Not `build`. `commandSurface.spec.ts` asserts there is no top-level
   * `build`, and that assertion is the canary for `alepha build` leaking in
   * through the DI graph - injecting one service registers its whole module.
   * Promoting ours would disarm the guard for the single name most likely to
   * leak.
   *
   * Not `destroy` either. Shortening the one command that deliberately refuses
   * to guess its environment is backwards: it is long on purpose.
   */
  public readonly deployCommand = $command({
    name: "deploy",
    description: AppsCommand.DEPLOY_DESCRIPTION,
    flags: AppsCommand.DEPLOY_FLAGS,
    handler: (args) => this.runDeploy(args),
  });

  /**
   * `lore apps redeploy` - one stored build onto every copy of an app whose
   * env ends with `--suffix`.
   *
   * ```bash
   * lore apps redeploy --app portal --suffix=-staging
   * ```
   *
   * For a project that runs one copy per tenant (a club, a shop), where a new
   * build has to reach all of them: push once with `lore artifacts push`, then
   * this. Each copy is started and followed in turn, exactly as `deploy --tag`
   * would.
   *
   * ## ⚠️ It never builds
   *
   * The same rule as a named `--tag` on `deploy`: N copies take the one stored
   * artifact, rather than N builds from this machine that only claim to be it.
   *
   * ## ⚠️ `--suffix` is required and never empty
   *
   * Every env ends with the empty string, so an omitted suffix would mean every
   * copy, production included, without the word appearing anywhere. Same
   * reasoning as `destroy` refusing to guess its `--env`.
   *
   * ## ⚠️ One failure does not stop the others
   *
   * The copies are independent tenants: leaving the rest on the old build
   * because one failed would turn one broken tenant into all of them lagging.
   * Every copy is attempted, and the command then exits non-zero naming each
   * one that failed, so CI still goes red.
   */
  public readonly redeploy = $command({
    name: "redeploy",
    description:
      "Deploy a stored build onto every copy of this app whose env ends with --suffix",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description: "Lore project slug, overriding LORE_PROJECT.",
        })
        .optional(),
      app: z
        .text({
          description:
            "App name. Defaults to the slugified `name` from package.json.",
        })
        .optional(),
      suffix: z
        .text({
          description:
            "Env suffix the copies share, e.g. `--suffix=-staging` (with `=`, since the value starts with a dash). Required: an empty one would match every copy.",
        })
        .optional(),
      tag: z
        .text({
          aliases: ["t"],
          description:
            "Stored build to deploy. Defaults to `latest`. Never builds.",
        })
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const suffix = flags.suffix?.trim();
      if (!suffix) {
        throw new AlephaError(
          "Name the copies with --suffix (e.g. `--suffix=-staging`). Every env ends with the empty string, so without it this would redeploy every copy, production included.",
        );
      }

      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);
      const app = await this.projects.resolveApp(flags.app, root);
      const tag = flags.tag ?? AppsCommand.DEFAULT_TAG;

      const items = await this.deployer.listInstances(projectId);
      const copies = items.filter(
        (item) => item.app === app && item.env.endsWith(suffix),
      );
      if (copies.length === 0) {
        throw new AlephaError(
          `${app} has no copy whose env ends with \`${suffix}\`, so there is nothing to redeploy.`,
        );
      }

      const noun = copies.length === 1 ? "copy" : "copies";
      this.log.info(
        `Redeploying ${app}@${tag} to ${copies.length} ${noun}: ${copies.map((copy) => copy.env).join(", ")}`,
      );

      const failed: string[] = [];
      for (const copy of copies) {
        try {
          const started = await this.deployer.start(projectId, copy.id, tag);
          const finished = await this.deployer.follow(projectId, started.id);
          if (finished.status === "succeeded") {
            this.log.info(`Deployed ${app}@${tag} to ${app}/${copy.env}`);
          } else {
            failed.push(
              `${copy.env}: ${finished.error || `ended ${finished.status}`}`,
            );
          }
        } catch (error) {
          failed.push(
            `${copy.env}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (failed.length > 0) {
        // ⚠️ Thrown, not logged: this runs in CI, and a partial redeploy must
        // not read as a green step.
        throw new AlephaError(
          `${failed.length} of ${copies.length} ${noun} did not take ${app}@${tag}. ${failed.join("; ")}`,
        );
      }
    },
  });

  public readonly appsCommand = $command({
    name: "apps",
    description: "Build and deploy this project's apps",
    children: [this.build, this.deploy, this.redeploy, this.destroy],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The deploy, once, for both primitives above.
   */
  protected async runDeploy(
    args: CommandHandlerArgs<typeof AppsCommand.DEPLOY_FLAGS>,
  ): Promise<void> {
    const { flags, root, run } = args;
    const project = this.client.resolveProject(flags.project);
    const projectId = await this.projects.resolve(project);
    const app = await this.projects.resolveApp(flags.app, root);
    const env = await this.projects.resolveEnv(flags.env, projectId, app);

    // ⚠️ First, and before anything is built. An app or env that was never
    // enrolled is a refusal, not a creation: minting a deploy target as a
    // side effect of a typo in `--env` is how `clbu` gets deployed to.
    const instance = await this.deployer.loadInstance(projectId, app, env);
    const tag = flags.tag ?? AppsCommand.DEFAULT_TAG;

    // ⚠️ The switch. A named tag never builds - see the class doc.
    if (!flags.tag) {
      await this.deployer.buildAndPush({
        project,
        projectId,
        app,
        env,
        tag,
        root,
        run,
        instance,
      });
    }

    const started = await this.deployer.start(
      projectId,
      instance.id,
      tag,
      flags.sigil,
    );
    this.log.info(`Deploying ${app}@${tag} to ${app}/${env}`, {
      deployment: started.id,
    });

    const finished = await this.deployer.follow(projectId, started.id);
    if (finished.status !== "succeeded") {
      // ⚠️ Non-zero, because this runs in CI. Throwing is what sets
      // `process.exitCode`; returning here would report a failed deploy as a
      // successful pipeline step.
      throw new AlephaError(
        finished.error ||
          `The deploy of ${app}@${tag} to ${app}/${env} ended ${finished.status}.`,
      );
    }

    this.log.info(
      `Deployed ${app}@${tag} to ${app}/${env}${finished.url ? ` - ${finished.url}` : ""}`,
    );
  }

  /**
   * Which targets this invocation builds.
   *
   * ⚠️ `--env` and `--target` together can CONTRADICT each other, and that is a
   * refusal rather than a precedence question: `--env xxx --target docker`
   * where `xxx` sits on a Cloudflare estate asks for two different things, and
   * silently picking one would produce bytes the operator did not ask for and
   * a deploy that fails much later.
   */
  protected async resolveTargets(
    flags: { project?: string; app?: string; env?: string; target?: string },
    root: string,
  ): Promise<string[]> {
    const named = (flags.target ?? "")
      .split(",")
      .map((it) => it.trim())
      .filter(Boolean);

    if (!flags.env) {
      // ⚠️ An empty list means "whatever the local config declares", which is
      // what `alepha build` with no `-t` does. Offline, and the only path that
      // needs no network at all.
      return named.length > 0 ? named : [""];
    }

    const implied = await this.targetForEnv(flags, root);
    if (named.length === 0) {
      return [implied];
    }
    if (named.length === 1 && named[0] === implied) {
      return named;
    }
    throw new AlephaError(
      `--env ${flags.env} needs \`--target ${implied}\`, but --target says \`${named.join(", ")}\`. Drop one of the two: an environment already decides what it can run.`,
    );
  }

  /**
   * The target one environment implies, resolved through Lore.
   *
   * The chain needs no new column: `(project, app, env)` names an
   * `app_instances` row, its `estateId` names an estate, the estate's TYPE
   * decides the accepted runtimes, and the runtime decides the target.
   */
  protected async targetForEnv(
    flags: { project?: string; app?: string; env?: string },
    root: string,
  ): Promise<string> {
    const project = this.client.resolveProject(flags.project);
    const projectId = await this.projects.resolve(project);
    const app = await this.projects.resolveApp(flags.app, root);

    const instance = await this.deployer.readInstance(
      projectId,
      app,
      flags.env as string,
    );
    return await this.deployer.targetForInstance(
      projectId,
      app,
      flags.env as string,
      instance,
    );
  }
}
