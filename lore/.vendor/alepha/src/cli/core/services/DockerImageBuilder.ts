import { $inject, AlephaError } from "alepha";
import type { AlephaMeta } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type { BuildRuntime } from "../atoms/buildOptions.ts";
import type { ImageOptions } from "../atoms/imageOptions.ts";
import { AlephaCliUtils } from "./AlephaCliUtils.ts";
import { BuildSlices } from "./BuildSlices.ts";

/**
 * Everything `alepha image` hands the builder: what was built, where, and how
 * the author wants it packaged.
 */
export interface ImageContext {
  /**
   * The app directory — where `alepha.config.ts` lives, and where a generated
   * Dockerfile lands so the author can commit and edit it.
   */
  root: string;

  /**
   * `dist` unless the build renamed it. The docker build context.
   */
  distDir: string;

  /**
   * The PRIMARY slice, whose entry wrapper the image runs. Same rule as the
   * manifest and every deployer: the first declared runtime.
   */
  runtime: BuildRuntime;

  /**
   * The author's `image:` configuration.
   */
  image: ImageOptions;

  /**
   * The name of a compiled binary inside `dist/`, when one was compiled.
   * Switches the Dockerfile to the minimal-base variant.
   */
  compile?: string;

  /**
   * `--tag`'s value, or true for `latest`. Absent writes the Dockerfile and
   * builds nothing.
   */
  build?: boolean | string;

  run: RunnerMethod;

  meta?: AlephaMeta;
}

/**
 * What the compile Dockerfile needs: the binary's name and the base image.
 */
interface ResolvedCompile {
  name: string;
  base: string;
}

/**
 * Generate Docker deployment configuration and optionally build the image.
 *
 * Two modes:
 *
 * 1. Standard (default) - copies the bundled JS + `package.json` and runs
 *    `bun install` (or `npm install`) inside the container.
 * 2. Compile - packages the single binary `BuildCompileTask` produces inside
 *    a minimal distroless image. No `node_modules` are ever installed. This
 *    task only writes that Dockerfile: the binary does not exist yet when it
 *    runs, so in this mode `--image` is built by `BuildCompileTask`, after.
 *
 * Creates:
 * - Dockerfile (compile or standard variant)
 * - Copies migrations directory if it exists
 * - Builds Docker image when `--image` flag is provided (standard mode)
 */
export class DockerImageBuilder {
  protected readonly slices = $inject(BuildSlices);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly log = $logger();

  /**
   * The base for a compiled image: no shell, no package manager, and exactly
   * the three libraries a Bun binary actually needs.
   *
   * ## ⚠️ It was `distroless/static-debian12`, and that never worked
   *
   * Measured, because the failure is invisible from the build side. A Bun
   * `--compile` binary is **not static at all** — not with the musl triple
   * either:
   *
   * ```
   * $ file dist/app
   * ELF 64-bit LSB executable, ARM aarch64, dynamically linked,
   * interpreter /lib/ld-musl-aarch64.so.1
   * $ ldd dist/app          # on alpine
   * Error loading shared library libstdc++.so.6: No such file or directory
   * Error loading shared library libgcc_s.so.1: No such file or directory
   * ```
   *
   * `distroless/static` carries no libc, so the binary could never start
   * there. What that looks like is `exec /app/app: no such file or directory`
   * — an error naming a file that plainly exists, from a container that just
   * stops. Nothing about it points at a base image.
   *
   * `cc-debian12` is the same distroless family plus glibc, `libstdc++` and
   * `libgcc`, which is exactly the set above. Verified by running a real
   * compiled binary on it: it boots and reaches the app's own configuration
   * checks.
   *
   * ⚠️ **Public, and read by `alepha image` to pick the Bun triple.** Two
   * copies of this string would eventually disagree, and the symptom would be
   * the unreadable error above.
   */
  public static readonly DEFAULT_COMPILE_BASE = "gcr.io/distroless/cc-debian12";

  /**
   * Write the Dockerfile when the app owns none, then build the image.
   */
  async run(ctx: ImageContext): Promise<void> {
    const distDir = ctx.distDir;
    const compile = this.resolveCompile(ctx);

    const dockerFrom =
      ctx.image.from ??
      (ctx.runtime === "bun" ? "oven/bun:alpine" : "node:24-alpine");
    const dockerCommand =
      ctx.image.command ?? (ctx.runtime === "bun" ? "bun" : "node");

    const dockerfile = this.fs.join(ctx.root, "Dockerfile");
    const owned = await this.fs.exists(dockerfile);

    await ctx.run({
      name: owned ? "check the Dockerfile" : "generate the Dockerfile",
      handler: async () => {
        const migrationsCopied = await this.copyMigrations(ctx.root, distDir);
        if (owned) {
          /*
            ⚠️ **Reused untouched, and a mismatch WARNS rather than fails.**
            The file is the author's once it exists — that is the whole point
            of generating it into the app directory rather than into `dist/`,
            which the build wipes. Failing on a difference would make an
            intentional edit feel like a bug.

            The warning exists only so the drift is not silent: a committed
            Dockerfile stops tracking `runtimeVersion` the moment
            `engines.node` moves, and nothing else would ever say so.
          */
          await this.warnOnDrift(dockerfile, ctx);
          return;
        }
        await this.writeDockerfile(ctx.root, distDir, {
          compile,
          standard: {
            image: dockerFrom,
            command: dockerCommand,
            entry: this.slices.entryFileName(ctx.runtime),
          },
          hasMigrations: migrationsCopied,
          hasDeps: await this.hasRuntimeDeps(ctx.root, distDir),
          install: ctx.image.install ?? [],
          env: ctx.image.env ?? {},
          volumes: ctx.image.volumes ?? [],
          user: this.resolveUser(ctx, compile),
          labels: {
            ...this.runtimeLabel(ctx),
            ...this.staticOciLabels(ctx),
          },
          facts: this.dockerfileHeaderFacts(ctx),
        });
      },
    });

    if (ctx.build) {
      await this.buildDockerImage(ctx, distDir);
    }
  }

  /**
   * Warn when a committed Dockerfile disagrees with what this build declares.
   *
   * ⚠️ **Never throws.** Only the facts the generated header records are
   * compared, so an author who rewrote the file entirely gets one warning and
   * not a wall of them.
   */
  protected async warnOnDrift(
    dockerfile: string,
    ctx: ImageContext,
  ): Promise<void> {
    let body: string;
    try {
      body = (await this.fs.readFile(dockerfile)).toString();
    } catch {
      return;
    }
    const declared = this.dockerfileHeaderFacts(ctx);
    const stale = Object.entries(declared).filter(
      ([, value]) => value && !body.includes(value),
    );
    if (stale.length === 0) {
      return;
    }
    this.log.warn(
      `${dockerfile} was generated from an earlier build and no longer matches it: ` +
        `${stale.map(([key, value]) => `${key} is now ${value}`).join(", ")}. ` +
        "The file is yours: update it, or delete it to regenerate.",
    );
  }

  /**
   * The manifest facts the generated header records, so a later build can say
   * which of them moved.
   */
  protected dockerfileHeaderFacts(ctx: ImageContext): Record<string, string> {
    return {
      runtime: ctx.runtime,
      entry: ctx.compile ?? this.slices.entryFileName(ctx.runtime),
    };
  }

  /**
   * The binary's name from `build.compile`, and the base image: distroless
   * unless `docker.from` names another. Returns null when compile mode is
   * disabled.
   *
   * The flag and the config were already merged and validated by the build
   * command (runtime, target, binary name); this only reads the result.
   */
  protected resolveCompile(ctx: ImageContext): ResolvedCompile | null {
    const name = ctx.compile;
    if (!name) {
      return null;
    }
    return {
      name,
      base: ctx.image.from ?? DockerImageBuilder.DEFAULT_COMPILE_BASE,
    };
  }

  /**
   * The user the container process runs as.
   *
   * The standard variant defaults to uid 1000 — present in both official
   * bases (`node:x:1000:1000`, `bun:x:1000:1000`) — so a public image does
   * not serve HTTP as root. Emitted numerically rather than by name because
   * `build.docker.from` is a supported override and `USER node` fails the
   * build outright on a base without that user.
   *
   * Compile mode has no default: distroless has no shell, so a declared
   * volume cannot be created and chowned at build time. An explicit `user`
   * is still honoured there.
   */
  protected resolveUser(
    ctx: ImageContext,
    compile: ResolvedCompile | null,
  ): string | null {
    const configured = ctx.image.user;
    if (configured) {
      return configured;
    }
    return compile ? null : "1000";
  }

  /**
   * Whether a resolved user is root, in which case the ownership dance
   * (`COPY --chown`, chowning volume directories) is pointless.
   */
  protected isRootUser(user: string | null): boolean {
    return user === null || user === "root" || user === "0";
  }

  /**
   * `--chown` / `chown` argument for a user. A value already carrying a
   * group (`1000:1000`, `node:node`) is taken verbatim; otherwise the user
   * doubles as the group, which is how both official bases are set up.
   */
  protected chownSpec(user: string): string {
    return user.includes(":") ? user : `${user}:${user}`;
  }

  /**
   * Escape a value for a Dockerfile `ENV key="value"` line.
   *
   * An unescaped space, quote or backslash produces a Dockerfile that
   * builds fine and sets the wrong thing, which is worse than a build
   * failure. JSON string syntax is a subset of what the Dockerfile parser
   * accepts for a double-quoted word.
   */
  protected escapeEnvValue(value: string): string {
    return JSON.stringify(value);
  }

  /**
   * `ENV` lines for the configured environment, one per key, in insertion
   * order. Emitted after the built-in `SERVER_HOST` so an app that sets it
   * wins.
   */
  protected renderEnv(env: Record<string, string>): string {
    return Object.entries(env)
      .map(([key, value]) => `ENV ${key}=${this.escapeEnvValue(value)}\n`)
      .join("");
  }

  /**
   * A single `VOLUME` instruction in exec form, which needs no escaping
   * rules of its own for paths carrying spaces.
   */
  protected renderVolumes(volumes: string[]): string {
    if (!volumes.length) {
      return "";
    }
    return `VOLUME ${JSON.stringify(volumes)}\n`;
  }

  /**
   * Create and chown every declared volume directory *before* its `VOLUME`
   * line: a named volume inherits ownership from the image directory at
   * that path, and anything done after the declaration is discarded.
   */
  protected renderVolumePrep(volumes: string[], user: string | null): string {
    if (!volumes.length || this.isRootUser(user)) {
      return "";
    }
    const paths = volumes.map((it) => JSON.stringify(it)).join(" ");
    return `RUN mkdir -p ${paths} && chown ${this.chownSpec(user as string)} ${paths}\n`;
  }

  protected async copyMigrations(
    root: string,
    distDir: string,
  ): Promise<boolean> {
    const migrationsDir = this.fs.join(root, "migrations");
    if (await this.fs.exists(migrationsDir)) {
      await this.fs.cp(
        migrationsDir,
        this.fs.join(root, distDir, "migrations"),
      );
      return true;
    }
    return false;
  }

  /**
   * Whether the produced `dist/package.json` declares any runtime
   * dependencies. Alepha apps normally bundle everything into the
   * server entry via Vite, leaving `dependencies: {}` — in which case
   * the generated Dockerfile's `RUN npm install` is wasted work
   * (and emits deprecation noise). Skip the line when empty.
   */
  protected async hasRuntimeDeps(
    root: string,
    distDir: string,
  ): Promise<boolean> {
    try {
      const pkg = await this.fs.readJsonFile<{
        dependencies?: Record<string, string>;
      }>(this.fs.join(root, distDir, "package.json"));
      return Object.keys(pkg.dependencies ?? {}).length > 0;
    } catch {
      // No package.json in dist/ → nothing to install.
      return false;
    }
  }

  protected async writeDockerfile(
    root: string,
    distDir: string,
    opts: {
      compile: ResolvedCompile | null;
      standard: { image: string; command: string; entry: string };
      hasMigrations: boolean;
      hasDeps: boolean;
      install: string[];
      env: Record<string, string>;
      volumes: string[];
      user: string | null;
      labels: Record<string, string>;
      /**
       * The manifest facts this file was generated from, recorded in its
       * header so a later build can say which of them have moved.
       */
      facts: Record<string, string>;
    },
  ): Promise<void> {
    /*
      ⚠️ **Not "DO NOT MODIFY".** This file lands in the app directory to be
      committed and edited: generating it once and then getting out of the way
      is the whole point. The header says where it came from, and names the
      facts `alepha image` compares against on a later run so the drift it
      warns about is legible rather than mysterious.
    */
    const header =
      "# Generated by `alepha image`, from this build's manifest:\n" +
      Object.entries(opts.facts)
        .map(([key, value]) => `#   ${key}: ${value}\n`)
        .join("") +
      "# It is yours now. Edit it freely; `alepha image` reuses it untouched\n" +
      "# and only warns when the facts above stop matching a later build.\n";

    const migrationsLine = opts.hasMigrations
      ? "COPY migrations ./migrations\n"
      : "";

    const envLines = this.renderEnv(opts.env);
    const volumeLines = this.renderVolumes(opts.volumes);
    const labelLines = this.renderLabels(opts.labels);

    let dockerfile: string;

    if (opts.compile) {
      // Root unless `build.docker.user` says otherwise, and the generated
      // file says so itself so it does not read as an oversight.
      const userLine = opts.user
        ? `USER ${opts.user}\n\n`
        : "# Runs as root: the distroless base has no shell, so a declared volume\n" +
          "# cannot be created and chowned at build time. Set `build.docker.user`\n" +
          "# to run as someone else.\n";
      // `install` is ignored in compile mode: distroless has no npm.
      dockerfile = `${header}FROM ${opts.compile.base}
WORKDIR /app
${labelLines ? `\n${labelLines}` : ""}
COPY ${opts.compile.name} .
${migrationsLine}
ENV SERVER_HOST=0.0.0.0
${envLines}${volumeLines ? `\n${volumeLines}` : ""}
${userLine}ENTRYPOINT ["/app/${opts.compile.name}"]
`;
    } else {
      const { image, command, entry } = opts.standard;
      // The default `DATA_DIR` sits inside `/app`, so a non-root process
      // needs to own what was copied there.
      const chownFlag = this.isRootUser(opts.user)
        ? ""
        : ` --chown=${this.chownSpec(opts.user as string)}`;
      // Skip `RUN <pm> install` when `dist/package.json` declares no
      // runtime deps — Alepha apps normally bundle everything via Vite,
      // making the install a no-op that just emits deprecation noise.
      const baseInstallLine = opts.hasDeps
        ? `RUN ${command === "bun" ? "bun" : "npm"} install\n`
        : "";
      // Install requested packages locally (no --global). They land in
      // `/app/node_modules/`, alongside the app's own deps. Use
      // `--no-save` so we don't mutate the bundled package.json. Node
      // module resolution walks up into `/app/node_modules/` when the
      // workspace lives under `/app/workspace/<deploy-id>/`.
      const extraInstallLine = opts.install.length
        ? `RUN npm install --no-save --no-fund --no-audit ${opts.install.join(" ")}\n`
        : "";
      // Both install lines and the volume prep need root, so `USER` lands
      // last, just above the command.
      const volumePrepLine = this.renderVolumePrep(opts.volumes, opts.user);
      const userLine = opts.user ? `USER ${opts.user}\n\n` : "";
      dockerfile = `${header}FROM ${image}
WORKDIR /app
${labelLines ? `\n${labelLines}` : ""}
COPY${chownFlag} . .

${baseInstallLine}${extraInstallLine}${volumePrepLine}
ENV SERVER_HOST=0.0.0.0
${envLines}${volumeLines ? `\n${volumeLines}` : ""}
${userLine}CMD ["${command}", "${entry}"]
`;
    }

    /*
      ⚠️ **In the APP directory, beside `alepha.config.ts`** — not in `dist/`,
      which `alepha build` wipes on every run. A file that cannot survive a
      build cannot be committed or edited, and this one is meant to be both.

      A monorepo has several apps, so the repository root would be wrong for
      the same reason.
    */
    await this.fs.writeFile(this.fs.join(root, "Dockerfile"), dockerfile);
  }

  /**
   * `dev.alepha.runtime`, the runtime the image actually runs, written into
   * the Dockerfile as a `LABEL` line.
   *
   * An image's runtime appears nowhere in its OCI index, so a registry
   * cannot answer it and a pusher's word for it is not evidence. The image
   * carries its own claim instead, and a reader (Lore's artifact registry)
   * gets it out of the config blob with one small GET.
   *
   * ⚠️ Emitted UNCONDITIONALLY, and deliberately not through
   * {@link staticOciLabels}: that one returns nothing unless
   * `build.docker.image.oci` is set, so routing this through it would mean
   * an app that never opted into OCI annotations ships an image whose push
   * is refused for a missing label, for a reason nothing in its config
   * explains. This label is Alepha's contract with its own registry, not an
   * annotation the user opts into.
   *
   * Only `node` and `bun` are reachable here: {@link run} returns early on
   * any target but `docker`, so `static` (which comes from
   * `target: "static"`) never gets this far. `workerd` is technically
   * reachable and deliberately left so — a Worker in a container is refused
   * at push time, where the refusal can name itself, rather than at build
   * time, which would be a behaviour change of its own.
   */
  protected runtimeLabel(ctx: ImageContext): Record<string, string> {
    // Same resolution BuildManifestTask uses, so the label and the
    // manifest cannot disagree about one build.
    return { "dev.alepha.runtime": ctx.runtime };
  }

  /**
   * The `org.opencontainers.image.*` annotations that do not depend on the
   * build invocation, written into the Dockerfile as `LABEL` lines.
   *
   * They belong in the file rather than on the `docker build` command,
   * because they describe the image the Dockerfile defines and must survive
   * a build the CLI did not run, such as a hand-written `docker buildx build`
   * on this file. `source` is what links the published package to its
   * repository on a registry like GHCR.
   *
   * A field left unset emits no label, never an empty one.
   */
  protected staticOciLabels(ctx: ImageContext): Record<string, string> {
    const imageConfig = ctx.image.image;
    if (!imageConfig?.oci) {
      return {};
    }

    const labels: Record<string, string | undefined> = {
      "org.opencontainers.image.source": imageConfig.source,
      "org.opencontainers.image.title": imageConfig.title,
      "org.opencontainers.image.description": imageConfig.description,
      "org.opencontainers.image.licenses": imageConfig.licenses,
    };

    return Object.fromEntries(
      Object.entries(labels).filter(
        ([, value]) => value !== undefined && value !== "",
      ),
    ) as Record<string, string>;
  }

  /**
   * `--label` arguments for the annotations that describe THIS build rather
   * than the source: the git revision, the build timestamp, and the version
   * taken from the resolved image tag. The config-driven ones are in the
   * Dockerfile — see {@link staticOciLabels}.
   */
  protected async buildOciLabelArgs(version: string): Promise<string[]> {
    const labels: Record<string, string | undefined> = {
      revision: await this.utils.getGitRevision(),
      created: this.dateTime.nowISOString(),
      version,
    };

    return Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(
        ([name, value]) =>
          `--label ${this.escapeShellArg(`org.opencontainers.image.${name}=${value}`)}`,
      );
  }

  /**
   * `LABEL` lines in exec form, which needs no escaping rules of its own for
   * a description carrying a quote or a space.
   *
   * Names arrive FULLY QUALIFIED. This used to prepend
   * `org.opencontainers.image.` to every key it was handed, which made it
   * impossible to render a label from any other namespace — and
   * `dev.alepha.runtime` is one.
   */
  protected renderLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .map(
        ([name, value]) =>
          `LABEL ${JSON.stringify(name)}=${JSON.stringify(value)}\n`,
      )
      .join("");
  }

  /**
   * Single-quote a value for the shell, which is what makes a `description`
   * carrying a quote or a space produce the label it says rather than a
   * broken `docker build` invocation.
   */
  protected escapeShellArg(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
  }

  /**
   * `docker build` the image. Public because in compile
   * mode `BuildCompileTask` calls it once the binary exists.
   */
  public async buildDockerImage(
    ctx: ImageContext,
    distDir: string,
  ): Promise<void> {
    const imageConfig = ctx.image.image;
    const flagValue = typeof ctx.build === "string" ? ctx.build : null;

    let imageTag: string;
    let version: string;

    if (!flagValue) {
      if (!imageConfig?.tag) {
        throw new AlephaError(
          "Flag '--image' requires 'build.docker.image.tag' in config",
        );
      }
      version = "latest";
      imageTag = `${imageConfig.tag}:${version}`;
    } else if (flagValue.startsWith(":")) {
      if (!imageConfig?.tag) {
        throw new AlephaError(
          "Flag '--image=:version' requires 'build.docker.image.tag' in config",
        );
      }
      version = flagValue.slice(1);
      imageTag = `${imageConfig.tag}:${version}`;
    } else if (flagValue.includes(":")) {
      // A full `name:tag` is taken verbatim.
      imageTag = flagValue;
      // The last colon: `registry:5000/app:1.2` carries one in the host.
      version = flagValue.slice(flagValue.lastIndexOf(":") + 1);
    } else {
      // A bare value is a VERSION, as the flag documents ("-i=<version> for
      // specific version"). It used to become the image *name*, so
      // `--image=1.3.4` silently built `1.3.4:latest`.
      if (!imageConfig?.tag) {
        throw new AlephaError(
          "Flag '--image=<version>' requires 'build.docker.image.tag' in config. Pass a full 'name:tag' to name the image explicitly.",
        );
      }
      version = flagValue;
      imageTag = `${imageConfig.tag}:${version}`;
    }

    const args: string[] = [];

    if (imageConfig?.args) {
      args.push(imageConfig.args);
    }

    if (imageConfig?.oci) {
      args.push(...(await this.buildOciLabelArgs(version)));
    }

    const argsStr = args.length > 0 ? `${args.join(" ")} ` : "";
    /*
      ⚠️ **The Dockerfile is in the app directory, the CONTEXT is `dist/`.**
      Both halves matter. The file has to live where it can be committed and
      edited, and the context has to be `dist/` so the Dockerfile's `COPY . .`
      keeps meaning the built output — a context of the app directory would
      drag `src/` and `node_modules/` into every build.
    */
    const dockerfile = this.fs.join(ctx.root, "Dockerfile");
    const dockerCmd = `docker build ${argsStr}-f ${dockerfile} -t ${imageTag} ${distDir}`;

    await ctx.run(dockerCmd, {
      alias: `docker build ${imageTag}`,
    });
  }
}
