import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { $client } from "alepha/server/links";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import type { AppController } from "lore/api/controllers/AppController";
import type { ProjectEstateController } from "lore/api/controllers/ProjectEstateController";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore apps build` - produce the bytes a deploy will ship.
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

  /**
   * ⚠️ Declared after `client`: a field initializer reading another field sees
   * `undefined` if that field is declared below it.
   */
  protected readonly apps = $client<AppController>(this.client.scope());
  protected readonly estates = $client<ProjectEstateController>(
    this.client.scope(),
  );

  /**
   * The tag a build carries when nobody names one.
   *
   * `latest` is `ArtifactService.MUTABLE_TAG`: the one tag whose bytes may
   * change, and replacing it in place IS the retention policy. Every other tag
   * is write-once.
   */
  public static readonly DEFAULT_TAG = "latest";

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

  public readonly appsCommand = $command({
    name: "apps",
    description: "Build and deploy this project's apps",
    children: [this.build],
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
    if (!instance?.estateId) {
      // ⚠️ Refused, not fallen back on. Building every target for an
      // environment that names no estate produces bytes nobody asked for and
      // hides the real problem, which is that the copy has nowhere to deploy.
      throw new AlephaError(
        `${app}/${flags.env} has no estate, so there is nothing to say what it can run. Choose one on its Settings tab, or pass --target.`,
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
        `Could not tell what ${app}/${flags.env} can run. Its estate is not lent to this project any more, or Lore did not say what it accepts.`,
      );
    }

    const target = AppsCommand.TARGET_FOR_RUNTIME[runtime];
    if (!target) {
      throw new AlephaError(
        `${app}/${flags.env} runs \`${runtime}\`, which this CLI has no build target for.`,
      );
    }
    return target;
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
