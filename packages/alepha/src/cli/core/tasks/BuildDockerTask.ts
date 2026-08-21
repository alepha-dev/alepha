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
    },
  ): Promise<void> {
    const header =
      "# This file was automatically generated. DO NOT MODIFY.\n" +
      "# Changes to this file will be lost when the code is regenerated.\n";

    const migrationsLine = opts.hasMigrations
      ? "COPY migrations ./migrations\n"
      : "";

    let dockerfile: string;

    if (opts.compile) {
      // `install` is ignored in compile mode — distroless has no npm.
      dockerfile = `${header}FROM ${opts.compile.base}
WORKDIR /app

COPY app .
${migrationsLine}
ENV SERVER_HOST=0.0.0.0

ENTRYPOINT ["/app/app"]
`;
    } else {
      const { image, command } = opts.standard;
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
      dockerfile = `${header}FROM ${image}
WORKDIR /app

COPY . .

${baseInstallLine}${extraInstallLine}
ENV SERVER_HOST=0.0.0.0

CMD ["${command}", "index.js"]
`;
    }

    await this.fs.writeFile(
      this.fs.join(root, distDir, "Dockerfile"),
      dockerfile,
    );
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
      version = flagValue.split(":")[1];
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
      const revision = await this.utils.getGitRevision();
      const created = this.dateTime.nowISOString();

      args.push(`--label "org.opencontainers.image.revision=${revision}"`);
      args.push(`--label "org.opencontainers.image.created=${created}"`);
      args.push(`--label "org.opencontainers.image.version=${version}"`);
    }

    const argsStr = args.length > 0 ? `${args.join(" ")} ` : "";
    const dockerCmd = `docker build ${argsStr}-t ${imageTag} ${distDir}`;

    await ctx.run(dockerCmd, {
      alias: `docker build ${imageTag}`,
    });
  }
}
