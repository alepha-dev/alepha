import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { BuildDockerTask } from "./BuildDockerTask.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Compile the build into one executable with `bun build --compile`, its
 * `public/` files embedded inside it.
 *
 * Runs last, after `BuildCompressTask`, so the precompressed `.br` and `.gz`
 * siblings are embedded too. It is the only compile path for every target:
 * the Docker task writes the Dockerfile for the binary, and when `--image`
 * asks for an image it is built here, once the binary exists.
 *
 * The embedding is a few lines appended to the generated `dist/index.js`: one
 * `with { type: "file" }` import per public file, which is how Bun keeps a
 * file's bytes inside the binary, then an `__alepha.set` handing the app the
 * map from URL path to embedded path before it boots, the way the SSR
 * manifest already arrives. `ReactServerProvider` serves that map through
 * `EmbeddedStaticFileSource`.
 *
 * Skipped with `--prebuilt`, which regenerates deploy config and bundles
 * nothing.
 */
export class BuildCompileTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly dockerTask = $inject(BuildDockerTask);
  protected readonly log = $logger();

  async run(ctx: BuildTaskContext): Promise<void> {
    const compile = ctx.options.compile;
    if (!compile || ctx.flags?.prebuilt) {
      return;
    }

    // `BuildCommand.resolveCompile` leaves an object; a raw config value is
    // tolerated for a caller that sets the atom directly.
    const config =
      typeof compile === "object"
        ? compile
        : typeof compile === "string"
          ? { name: compile }
          : {};

    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const dist = this.fs.join(ctx.root, distDir);
    const name = config.name ?? "app";
    const target = config.target ?? this.defaultBunTarget(ctx.options.target);

    await ctx.run({
      name: "assert no externals (compile mode)",
      handler: async () => {
        await this.assertNoExternals(dist);
      },
    });

    await ctx.run({
      name: "embed public files",
      handler: async () => {
        await this.embedPublicFiles(dist, publicDir, this.builtAt(ctx));
      },
    });

    await ctx.run(
      this.buildCompileCommand(name, target, config.minify ?? true),
      { alias: `bun build --compile (${target})`, root: dist },
    );

    await ctx.run({
      name: "cleanup pre-compile artifacts",
      handler: async () => {
        await this.cleanupPreCompileArtifacts(dist, publicDir);
      },
    });

    // The Docker task copies them for its image; a bare binary needs them
    // beside it just the same.
    if (ctx.options.target !== "docker") {
      await ctx.run({
        name: "copy migrations",
        handler: async () => {
          await this.copyMigrations(ctx.root, dist);
        },
      });
    }

    await this.logBinary(this.fs.join(dist, name));

    if (ctx.options.target === "docker" && ctx.flags?.image) {
      await this.dockerTask.buildDockerImage(ctx, distDir);
    }
  }

  /**
   * The build time, in epoch milliseconds, that every embedded file takes as
   * its modification time: the build's own date when it has one, so the
   * binary and its `/version` agree, and now otherwise.
   */
  protected builtAt(ctx: BuildTaskContext): number {
    const date = ctx.meta?.build.date;
    const parsed = date ? Date.parse(date) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : this.dateTime.nowMillis();
  }

  /**
   * The Bun target triple when `build.compile.target` names none: this
   * machine for `bare`, linux-musl on this machine's CPU for `docker`, since
   * that is the container's OS whatever the build host.
   */
  protected defaultBunTarget(buildTarget: string | undefined): string {
    const arch =
      process.arch === "x64" || process.arch === "arm64"
        ? process.arch
        : undefined;
    const platform =
      process.platform === "darwin"
        ? "darwin"
        : process.platform === "linux"
          ? "linux"
          : process.platform === "win32"
            ? "windows"
            : undefined;

    if (!arch || (buildTarget !== "docker" && !platform)) {
      throw new AlephaError(
        `No Bun target for '${process.platform}-${process.arch}'. Set \`build.compile.target\` explicitly.`,
      );
    }

    return buildTarget === "docker"
      ? `bun-linux-${arch}-musl`
      : `bun-${platform}-${arch}`;
  }

  /**
   * The `bun build --compile` invocation. Runs from `<root>/<dist>`, so the
   * entry path stays relative and the binary lands beside the migrations.
   */
  protected buildCompileCommand(
    name: string,
    target: string,
    minify: boolean,
  ): string {
    return [
      "bun build",
      "--compile",
      `--target=${target}`,
      minify ? "--minify" : "",
      `--outfile=${name}`,
      "index.js",
    ]
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Compile mode requires fully-bundled output. If Vite left anything in
   * `dist/package.json`'s `dependencies`, fail loudly so the user can
   * either bundle the dep or disable compile.
   */
  protected async assertNoExternals(dist: string): Promise<void> {
    const pkgPath = this.fs.join(dist, "package.json");
    if (!(await this.fs.exists(pkgPath))) {
      return;
    }
    let pkg: { dependencies?: Record<string, string> };
    try {
      pkg = JSON.parse((await this.fs.readFile(pkgPath)).toString());
    } catch {
      return;
    }
    const names = Object.keys(pkg.dependencies ?? {});
    if (names.length > 0) {
      throw new AlephaError(
        `Cannot use compile mode: the following dependencies were not bundled by Vite: ${names.join(", ")}. ` +
          "All dependencies must be bundleable to produce a single-binary build.",
      );
    }
  }

  /**
   * Append the embedding to `dist/index.js`: one file import per public
   * file, in a stable order, and the map the app reads at boot. Dot files
   * are left out, as the disk source leaves them out. An app with no client
   * has nothing to embed.
   */
  protected async embedPublicFiles(
    dist: string,
    publicDir: string,
    builtAt: number,
  ): Promise<void> {
    const pub = this.fs.join(dist, publicDir);
    if (!(await this.fs.exists(pub))) {
      return;
    }

    const files: string[] = [];
    const entries = (await this.fs.ls(pub, { recursive: true }))
      .map((entry) => entry.replace(/\\/g, "/"))
      .sort();
    for (const entry of entries) {
      const stat = await this.fs.stat(this.fs.join(pub, entry));
      if (!stat.isDirectory) {
        files.push(entry);
      }
    }
    if (files.length === 0) {
      return;
    }

    const imports = files.map(
      (file, i) =>
        `import a${i} from ${JSON.stringify(`./${publicDir}/${file}`)} with { type: "file" };`,
    );
    const map = files
      .map((file, i) => `${JSON.stringify(`/${file}`)}: a${i}`)
      .join(", ");

    const indexPath = this.fs.join(dist, "index.js");
    const index = (await this.fs.readFile(indexPath)).toString();
    await this.fs.writeFile(
      indexPath,
      `${index.trimEnd()}\n\n` +
        "// Embedded by `alepha build --compile`: every public file, read from inside the binary.\n" +
        `${imports.join("\n")}\n` +
        `__alepha.set("alepha.server.static.embedded", { builtAt: ${builtAt}, files: { ${map} } });\n`,
    );
  }

  /**
   * Remove what the binary now carries. `manifest.json` stays (deploy
   * tooling reads it), and so do `migrations/`, which the app reads from
   * disk.
   */
  protected async cleanupPreCompileArtifacts(
    dist: string,
    publicDir: string,
  ): Promise<void> {
    for (const target of ["server", "index.js", "package.json", publicDir]) {
      const path = this.fs.join(dist, target);
      if (await this.fs.exists(path)) {
        await this.fs.rm(path, { recursive: true });
      }
    }
  }

  protected async copyMigrations(root: string, dist: string): Promise<void> {
    const migrationsDir = this.fs.join(root, "migrations");
    if (await this.fs.exists(migrationsDir)) {
      await this.fs.cp(migrationsDir, this.fs.join(dist, "migrations"));
    }
  }

  protected async logBinary(path: string): Promise<void> {
    if (!(await this.fs.exists(path))) {
      return;
    }
    const { size } = await this.fs.stat(path);
    this.log.info(`Compiled ${path} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}
