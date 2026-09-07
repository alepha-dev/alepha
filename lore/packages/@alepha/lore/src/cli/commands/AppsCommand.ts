import { $inject, AlephaError, z } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import type { AppController } from "lore/api/controllers/AppController";
import type { DeployController } from "lore/api/controllers/DeployController";
import type { ProjectEstateController } from "lore/api/controllers/ProjectEstateController";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { ArtifactCommand } from "./ArtifactCommand.ts";

/**
 * `lore apps build` and `lore apps deploy` - produce the bytes, and place them.
 *
 * ```bash
 * lore apps deploy                 # build, push, deploy
 * lore apps deploy --tag 0.28.0    # deploy the stored artifact, NO build
 * ```
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
 */
export class AppsCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly cli = $inject(CliProvider);

  /**
   * The push step, as the command an operator would have typed.
   *
   * ⚠️ **Not a second uploader.** `lore artifacts push` shipped in epic #27 and
   * six CI invocations already use it; a `lore apps push` beside it would be a
   * duplicate rather than a feature, and two commands that both upload an
   * artifact is how the tarball on disk and the build in `dist/` start
   * disagreeing. Reaching for the command object rather than for
   * `ArtifactUploader` keeps the packing, the maps sibling, the `--force`
   * semantics and the cleanup on one path.
   */
  protected readonly artifactCommand = $inject(ArtifactCommand);

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
   * Which `alepha build -t` produces which runtime.
   *
   * ⚠️ **The `node` row is an inference, not a lookup.** A manifest carries a
   * RUNTIME and never a target, and `runtime: node` is producible by
   * `--target bare` and by `--target docker` alike. `bare` is chosen because
   * epic #1 removed the container and `buildManifest`'s own doc describes the
   * node case as "spawn a process against a directory with no entry point".
   * **If Bay ever consumes a docker image, this table is where that changes.**
   */
  protected static readonly TARGET_FOR_RUNTIME: Record<string, string> = {
    workerd: "cloudflare",
    node: "bare",
    bun: "bare",
    static: "static",
  };

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
        const out = `${app}_${target || "default"}_${tag}`;
        await run({
          name: `build ${target || "(config)"} → dist/${out}`,
          handler: async () => {
            await this.buildOnce(root, target);
            await this.collect(root, out);
          },
        });
      }

      this.log.info(`Built ${targets.length} target(s) for ${app} ${tag}`, {
        targets,
      });
    },
  });

  public readonly deploy = $command({
    name: "deploy",
    description: "Deploy this app onto one of its environments",
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
            "Which deployed copy to place it on. Unlike `apps build`, this names the instance, not a target. Falls back to LORE_ENV then the project's default environment.",
        })
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);
      const app = await this.projects.resolveApp(flags.app, root);
      const env = this.projects.assertEnv(
        await this.projects.resolveEnv(flags.env, project),
        app,
      );

      // ⚠️ First, and before anything is built. An app or env that was never
      // enrolled is a refusal, not a creation: minting a deploy target as a
      // side effect of a typo in `--env` is how `clbu` gets deployed to.
      const instance = await this.loadInstance(projectId, app, env);
      const tag = flags.tag ?? AppsCommand.DEFAULT_TAG;

      // ⚠️ The switch. A named tag never builds - see the class doc.
      if (!flags.tag) {
        await this.buildAndPush({
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

      const started = await this.start(projectId, instance.id, tag);
      this.log.info(`Deploying ${app}@${tag} to ${app}/${env}`, {
        deployment: started.id,
      });

      const finished = await this.follow(projectId, started.id);
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
    },
  });

  public readonly appsCommand = $command({
    name: "apps",
    description: "Build and deploy this project's apps",
    children: [this.build, this.deploy],
    handler: async ({ help }) => {
      help();
    },
  });

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

    const instance = await this.apps.getApp({
      params: { projectId, app, env: flags.env as string },
    });
    return await this.targetForInstance(
      projectId,
      app,
      flags.env as string,
      instance,
    );
  }

  /**
   * The same answer, for a caller that already holds the instance row.
   *
   * `lore apps deploy` has to load it anyway - it needs the id to start a run,
   * and its absence is the refusal that must come before anything is built - so
   * asking Lore for it a second time would be a request bought with nothing.
   */
  protected async targetForInstance(
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

    const target = AppsCommand.TARGET_FOR_RUNTIME[runtime];
    if (!target) {
      throw new AlephaError(
        `${app}/${env} runs \`${runtime}\`, which this CLI has no build target for.`,
      );
    }
    return target;
  }

  /**
   * The deployed copy this invocation is about, or a refusal saying where to
   * make one.
   *
   * ## ⚠️ A missing instance is refused, never created
   *
   * `app_instances` is unique on `(projectId, app, env)` and `AppService`
   * lowercases and pattern-checks each half, so `--env Production` normalises
   * onto an existing row while `--env prod` does not. The near-miss is the case
   * that matters: creating a deploy target as a side effect of a typo is how
   * `clbu` gets deployed to, and epic #30 accepted the typo cost precisely
   * because creation is always an explicit act.
   *
   * ⚠️ Only a 404 becomes this message. An expired key, an unreachable Lore or
   * a 403 are different problems and must not be reported as "no such app".
   */
  protected async loadInstance(
    projectId: number,
    app: string,
    env: string,
  ): Promise<{ id: string; estateId?: string }> {
    try {
      const instance = await this.apps.getApp({
        params: { projectId, app, env },
      });
      if (instance?.id) {
        return instance as { id: string; estateId?: string };
      }
    } catch (error) {
      if (!HttpError.is(error, 404)) {
        throw error;
      }
    }
    throw new AlephaError(
      `${app}/${env} is not a deployed copy of this project, so there is nowhere to deploy it. Create it on the project's Apps page, or with the \`app_instance_create\` MCP tool - naming one here would not make it exist.`,
    );
  }

  /**
   * The first two thirds of the zero-flag cascade, stopping on the first
   * failure because each step is the input of the next.
   *
   * ⚠️ **It builds ONE target and does not {@link collect}.** `collect` exists
   * so several targets do not overwrite each other's `dist/`; here there is
   * exactly one, and `WorkspacePacker` tars the whole of `dist/` - so a
   * collected copy would ride inside the artifact as `dist/<app>_<target>_<tag>`
   * and double it. {@link buildOnce} is the same method `lore apps build` runs,
   * so there is still no second build path.
   */
  protected async buildAndPush(input: {
    project: string;
    projectId: number;
    app: string;
    env: string;
    tag: string;
    root: string;
    run: (task: { name: string; handler: () => Promise<void> }) => Promise<any>;
    instance: { estateId?: string };
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
        await this.buildOnce(input.root, target);
      },
    });

    await this.cli.run(this.artifactCommand.push, {
      root: input.root,
      argv: `--project ${input.project} --app ${input.app} --tag ${input.tag}`,
    });
  }

  /**
   * Ask Lore to start a run.
   *
   * ⚠️ The body carries a tag and nothing else. The estate is the server's to
   * resolve from the instance - see the class doc.
   */
  protected async start(
    projectId: number,
    instanceId: string,
    tag: string,
  ): Promise<{ id: string; status: string }> {
    try {
      return await this.deploys.startDeploy({
        params: { projectId, instanceId },
        body: { tag },
      });
    } catch (error) {
      // ⚠️ The reason in words, not a status code. Every refusal on this path
      // is written to be read by somebody who often cannot fix it themselves -
      // the runtime gate names the build to produce, and the credential and
      // kill-switch clauses name whose estate it is - so the message is the
      // deliverable and swallowing it for an HTTP number would waste it.
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
   * secret this command holds must not reach a record every member of the
   * project can read. It is bounded by `DeployRegistry.MAX_LOG_LINES`, so this
   * cannot print without limit either.
   */
  protected async follow(
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
      if (AppsCommand.TERMINAL.includes(status)) {
        return { status, error: row?.error, url: row?.url };
      }

      if (
        this.dateTime.nowMillis() - startedAt >
        AppsCommand.FOLLOW_TIMEOUT_MS
      ) {
        throw new AlephaError(
          `Stopped following deploy ${deploymentId} after 15 minutes. It is still running - watch it on the copy's Deploy tab.`,
        );
      }

      await this.dateTime.wait(AppsCommand.POLL_INTERVAL_MS);
    }
  }

  /**
   * One `alepha build`, as a subprocess.
   *
   * ⚠️ **No env-specific value is passed, ever.** The command line carries a
   * target and nothing else: that is what keeps two envs on one estate type
   * byte-identical, which is the property promotion depends on.
   */
  protected async buildOnce(root: string, target: string): Promise<void> {
    const flags = target ? ` -t ${target}` : "";
    // `bare` needs its runtime said out loud: the target alone leaves it at the
    // default, and a manifest that names the wrong runtime lands the push under
    // the wrong identity.
    const runtime = target === "bare" ? " --runtime node" : "";
    await this.shell.run(`npx alepha build${flags}${runtime}`, { root });
  }

  /**
   * Move `dist/` aside so the next target has somewhere to build.
   *
   * ⚠️ `<app>_<target>_<tag>` is a LOCAL OUTPUT DIRECTORY and never an artifact
   * identity. Epic #18 rejected `my-app_1.2.3_cloudflare.tar.gz` explicitly: it
   * makes two builds of one release look like two releases. The identity is
   * `(projectId, app, tag, runtime)`, and `runtime` is read by the SERVER out
   * of the artifact's own `dist/manifest.json` at push time, never from a
   * filename.
   */
  protected async collect(root: string, out: string): Promise<void> {
    const dist = this.fs.join(root, "dist");
    const target = this.fs.join(root, "dist", out);
    if (!(await this.fs.exists(dist))) {
      throw new AlephaError(
        `The build produced no dist/ under ${root}, so there is nothing to collect.`,
      );
    }
    await this.fs.rm(target, { recursive: true, force: true });
    await this.fs.cp(dist, target);
  }
}
