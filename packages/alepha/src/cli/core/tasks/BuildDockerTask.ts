import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider } from "alepha/system";

import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Resolved compile options after merging config + flag defaults.
 */
interface ResolvedCompile {
  target: string;
  base: string;
  minify: boolean;
}

/**
 * Generate Docker deployment configuration and optionally build the image.
 *
 * Two modes:
 *
 * 1. Standard (default) - copies the bundled JS + `package.json` and runs
 *    `bun install` (or `npm install`) inside the container.
 * 2. Compile - runs `bun build --compile` to produce a single static binary
 *    and packages it inside a minimal distroless image. No `node_modules`
 *    are ever installed; all dependencies must be bundled by Vite. Requires
 *    `runtime: "bun"`.
 *
 * Creates:
 * - Dockerfile (compile or standard variant)
 * - Copies migrations directory if it exists
 * - Builds Docker image when `--image` flag is provided
 */
export class BuildDockerTask extends BuildTask {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.options.target !== "docker") {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const { runtime } = ctx.options;
    const compile = this.resolveCompile(ctx);

    const dockerFrom =
      ctx.options.docker?.from ??
      (runtime === "bun" ? "oven/bun:alpine" : "node:24-alpine");
    const dockerCommand =
      ctx.options.docker?.command ?? (runtime === "bun" ? "bun" : "node");

    if (compile) {
      await ctx.run({
        name: "assert no externals (compile mode)",
        handler: async () => {
          await this.assertNoExternals(ctx.root, distDir);
        },
      });

      await ctx.run(this.buildCompileCommand(compile), {
        alias: `bun build --compile (${compile.target})`,
        root: this.fs.join(ctx.root, distDir),
      });

      await ctx.run({
        name: "cleanup pre-compile artifacts",
        handler: async () => {
          await this.cleanupPreCompileArtifacts(ctx.root, distDir);
        },
      });
    }

    await ctx.run({
      name: "generate deploy config (docker)",
      handler: async () => {
        const migrationsCopied = await this.copyMigrations(ctx.root, distDir);
        const hasDeps = await this.hasRuntimeDeps(ctx.root, distDir);
        await this.writeDockerfile(ctx.root, distDir, {
          compile,
          standard: { image: dockerFrom, command: dockerCommand },
          hasMigrations: migrationsCopied,
          hasDeps,
          install: ctx.options.docker?.install ?? [],
          env: ctx.options.docker?.env ?? {},
          volumes: ctx.options.docker?.volumes ?? [],
          user: this.resolveUser(ctx, compile),
        });
      },
    });

    if (ctx.flags?.image) {
      await this.buildDockerImage(ctx, distDir);
    }
  }

  /**
   * Merge the user-supplied compile config with sensible defaults.
   * Returns null when compile mode is disabled.
   */
  protected resolveCompile(ctx: BuildTaskContext): ResolvedCompile | null {
    const raw = ctx.options.docker?.compile;
    if (!raw) {
      return null;
    }

    if (ctx.options.runtime !== "bun") {
      throw new AlephaError(
        `Compile mode requires runtime 'bun', got '${ctx.options.runtime}'`,
      );
    }

    const config = typeof raw === "object" ? raw : {};

    return {
      target: config.target ?? this.defaultBunTarget(),
      base: config.base ?? "gcr.io/distroless/static-debian12",
      minify: config.minify ?? true,
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
    ctx: BuildTaskContext,
    compile: ResolvedCompile | null,
  ): string | null {
    const configured = ctx.options.docker?.user;
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

  /**
   * Resolve the default Bun target triple for the current host arch.
   * Always targets linux-musl (the container OS), regardless of build host.
   */
  protected defaultBunTarget(): string {
    switch (process.arch) {
      case "x64":
        return "bun-linux-x64-musl";
      case "arm64":
        return "bun-linux-arm64-musl";
      default:
        throw new AlephaError(
          `No bun linux-musl target available for host arch '${process.arch}'. ` +
            "Set `build.docker.compile.target` explicitly.",
        );
    }
  }

  /**
   * Build the `bun build --compile` invocation. Runs from `<root>/<dist>` so
   * the entry path stays relative and the output lands next to the migrations.
   */
  protected buildCompileCommand(compile: ResolvedCompile): string {
    const parts = [
      "bun build",
      "--compile",
      `--target=${compile.target}`,
      compile.minify ? "--minify" : "",
      "--outfile=app",
      "index.js",
    ].filter(Boolean);
    return parts.join(" ");
  }

  /**
   * Compile mode requires fully-bundled output. If Vite left anything in
   * `dist/package.json`'s `dependencies`, fail loudly so the user can
   * either bundle the dep or disable compile.
   */
  protected async assertNoExternals(
    root: string,
    distDir: string,
  ): Promise<void> {
    const pkgPath = this.fs.join(root, distDir, "package.json");
    if (!(await this.fs.exists(pkgPath))) {
      return;
    }
    let pkg: { dependencies?: Record<string, string> };
    try {
      pkg = JSON.parse((await this.fs.readFile(pkgPath)).toString());
    } catch {
      return;
    }
    const deps = pkg.dependencies ?? {};
    const names = Object.keys(deps);
    if (names.length > 0) {
      throw new AlephaError(
        `Cannot use compile mode: the following dependencies were not bundled by Vite: ${names.join(", ")}. ` +
          "All dependencies must be bundleable to produce a single-binary build.",
      );
    }
  }

  /**
   * Remove artifacts that are no longer needed once the binary exists.
   * The binary embeds the JS bundle and runtime; the standalone files
   * would just bloat the image.
   */
  protected async cleanupPreCompileArtifacts(
    root: string,
    distDir: string,
  ): Promise<void> {
    const targets = [
      this.fs.join(root, distDir, "server"),
      this.fs.join(root, distDir, "index.js"),
      this.fs.join(root, distDir, "package.json"),
    ];
    for (const target of targets) {
      if (await this.fs.exists(target)) {
        await this.fs.rm(target, { recursive: true });
      }
    }
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
      standard: { image: string; command: string };
      hasMigrations: boolean;
      hasDeps: boolean;
      install: string[];
      env: Record<string, string>;
      volumes: string[];
      user: string | null;
    },
  ): Promise<void> {
    const header =
      "# This file was automatically generated. DO NOT MODIFY.\n" +
      "# Changes to this file will be lost when the code is regenerated.\n";

    const migrationsLine = opts.hasMigrations
      ? "COPY migrations ./migrations\n"
      : "";

    const envLines = this.renderEnv(opts.env);
    const volumeLines = this.renderVolumes(opts.volumes);

    let dockerfile: string;

    if (opts.compile) {
      // Root unless `build.docker.user` says otherwise, and the generated
      // file says so itself so it does not read as an oversight.
      const userLine = opts.user
        ? `USER ${opts.user}\n\n`
        : "# Runs as root: the distroless base has no shell, so a declared volume\n" +
          "# cannot be created and chowned at build time. Set `build.docker.user`\n" +
          "# to run as someone else.\n";
      // `install` is ignored in compile mode — distroless has no npm.
      dockerfile = `${header}FROM ${opts.compile.base}
WORKDIR /app

COPY app .
${migrationsLine}
ENV SERVER_HOST=0.0.0.0
${envLines}${volumeLines ? `\n${volumeLines}` : ""}
${userLine}ENTRYPOINT ["/app/app"]
`;
    } else {
      const { image, command } = opts.standard;
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

COPY${chownFlag} . .

${baseInstallLine}${extraInstallLine}${volumePrepLine}
ENV SERVER_HOST=0.0.0.0
${envLines}${volumeLines ? `\n${volumeLines}` : ""}
${userLine}CMD ["${command}", "index.js"]
`;
    }

    await this.fs.writeFile(
      this.fs.join(root, distDir, "Dockerfile"),
      dockerfile,
    );
  }

  /**
   * `--label` arguments for the `org.opencontainers.image.*` annotations.
   *
   * Three are always derived (revision, created, version); the other four
   * are config, and a field left unset emits no label rather than an empty
   * one. `source` in particular is what links a package to its repository
   * on GHCR, and is deliberately never read from the git remote — see
   * `build.docker.image.source`.
   */
  protected async buildOciLabelArgs(
    imageConfig: {
      source?: string;
      title?: string;
      description?: string;
      licenses?: string;
    },
    version: string,
  ): Promise<string[]> {
    const labels: Record<string, string | undefined> = {
      revision: await this.utils.getGitRevision(),
      created: this.dateTime.nowISOString(),
      version,
      source: imageConfig.source,
      title: imageConfig.title,
      description: imageConfig.description,
      licenses: imageConfig.licenses,
    };

    return Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(
        ([name, value]) =>
          `--label ${this.escapeShellArg(`org.opencontainers.image.${name}=${value}`)}`,
      );
  }

  /**
   * Single-quote a value for the shell, which is what makes a `description`
   * carrying a quote or a space produce the label it says rather than a
   * broken `docker build` invocation.
   */
  protected escapeShellArg(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
  }

  protected async buildDockerImage(
    ctx: BuildTaskContext,
    distDir: string,
  ): Promise<void> {
    const imageConfig = ctx.options.docker?.image;
    const flagValue =
      typeof ctx.flags?.image === "string" ? ctx.flags.image : null;

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
      args.push(...(await this.buildOciLabelArgs(imageConfig, version)));
    }

    const argsStr = args.length > 0 ? `${args.join(" ")} ` : "";
    const dockerCmd = `docker build ${argsStr}-t ${imageTag} ${distDir}`;

    await ctx.run(dockerCmd, {
      alias: `docker build ${imageTag}`,
    });
  }
}
