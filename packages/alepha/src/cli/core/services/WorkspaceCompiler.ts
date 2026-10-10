import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import type { BuildRuntime } from "../atoms/buildOptions.ts";
import { BuildSlices } from "./BuildSlices.ts";
import { DesktopAdapterResolver } from "./DesktopAdapterResolver.ts";

/**
 * What `alepha compile` produces: one executable holding the app, its server
 * bundle and every file under `public/`.
 */
export interface WorkspaceCompileOptions {
  /**
   * The workspace root. `dist/` is read from here and the binary lands in it.
   */
  root: string;

  /**
   * File name of the binary inside `dist/`.
   */
  name: string;

  /**
   * Bun target triple, e.g. `bun-linux-arm64-musl`.
   *
   * ⚠️ **Not inherited from a default when the caller knows better.** A Bun
   * `--compile` binary is not fully static: the triple picks the libc, so an
   * image built on a `scratch` or distroless base has to be handed the musl
   * triple or it produces a container whose binary will not start, with an
   * error that says nothing about why. `alepha image` drives this rather than
   * taking whatever the host would default to.
   */
  target?: string;

  /**
   * Minify the compiled output.
   */
  minify?: boolean;

  /**
   * `dist` and `public` directory names, when they are not the defaults.
   */
  output?: { dist?: string; public?: string };

  /**
   * The slices the build produced, so the cleanup removes every entry wrapper
   * rather than guessing at one. Read from `manifest.json` when omitted.
   */
  runtimes?: BuildRuntime[];

  /**
   * The build time every embedded file takes as its modification time.
   */
  builtAt?: number;

  /**
   * Copy `migrations/` beside the binary. A bare binary needs them; an image
   * copies them itself.
   */
  migrations?: boolean;
}

/**
 * Compile a built workspace into one executable with `bun build --compile`,
 * its `public/` files embedded inside it.
 *
 * ## ⚠️ It compiles the BUN slice, and only that one
 *
 * `bun build --compile` is what exists, so the binary is a Bun binary and the
 * bundle it embeds has to be the one resolved against Bun's export conditions.
 * A `dist/` may hold several slices and the node slice runs under Bun, which
 * makes falling back to it plausible and wrong: it would compile the generic
 * build and quietly discard the reason the bun slice exists. A missing bun
 * slice is named instead.
 *
 * When Node gains the same capability this switches which slice it picks, and
 * nothing else moves.
 *
 * ## Why this is a service and not just `CompileCommand`
 *
 * The same reason {@link WorkspacePacker} is one: `Alepha.inject` registers the
 * module that DECLARES a service, so injecting a command from outside
 * `alepha/cli` registers the whole CLI. `alepha image` needs to compile
 * (#E63), and it must be able to without growing a `build`, a `dev` and a
 * `verify` it never asked for.
 */
export class WorkspaceCompiler {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly slices = $inject(BuildSlices);
  protected readonly desktopAdapters = $inject(DesktopAdapterResolver);
  protected readonly log = $logger();

  /**
   * Compile `dist/` into one binary and say where it landed.
   *
   * Reads `./dist` and nothing else: it never unpacks an archive. If you have
   * one, unpack it first.
   */
  async compile(options: WorkspaceCompileOptions): Promise<string> {
    const distDir = options.output?.dist ?? "dist";
    const publicDir = options.output?.public ?? "public";
    const dist = this.fs.join(options.root, distDir);
    const bunEntry = this.slices.entryFileName("bun");

    await this.assertBunSlice(dist, bunEntry);
    await this.assertNoExternals(dist);
    await this.embedPublicFiles(
      dist,
      publicDir,
      options.builtAt ?? this.dateTime.nowMillis(),
      bunEntry,
    );

    const target = options.target ?? this.defaultBunTarget();
    await this.shell.run(
      this.buildCompileCommand(
        options.name,
        target,
        options.minify ?? true,
        bunEntry,
      ),
      { root: dist },
    );

    await this.cleanupPreCompileArtifacts(
      dist,
      publicDir,
      options.runtimes ?? (await this.declaredRuntimes(dist)),
    );

    if (options.migrations !== false) {
      await this.copyMigrations(options.root, dist);
    }

    const binary = this.fs.join(dist, options.name);
    await this.logBinary(binary);
    return binary;
  }

  /**
   * Compile `dist/` into a native macOS app, `dist/<name>.app`, with
   * `@alepha/desktop` resolved from the app's own dependencies.
   *
   * ⚠️ **Nothing in `dist/` changes until everything succeeded.** Every check
   * (the config, the host, the target, the bun slice, the package, the tools)
   * runs first. Then `dist/` is copied into a staging directory, where the
   * public files are embedded, the shell, supervisor and server Worker
   * entries are generated and compiled, and the bundle is assembled. Only a
   * finished bundle is promoted into `dist/`, after which the inputs the
   * binary now carries are removed, as an ordinary compile does. A failure
   * anywhere leaves `dist/` exactly as the build wrote it, so the command can
   * simply be run again.
   *
   * V1 targets the machine it runs on: macOS, its own architecture.
   */
  async compileDesktop(
    options: WorkspaceCompileOptions & { config: unknown },
  ): Promise<string> {
    const distDir = options.output?.dist ?? "dist";
    const publicDir = options.output?.public ?? "public";
    const dist = this.fs.join(options.root, distDir);
    const bunEntry = this.slices.entryFileName("bun");
    const native = `bun-darwin-${this.hostArch()}`;

    if (this.hostPlatform() !== "darwin") {
      throw new AlephaError(
        `\`alepha compile --desktop\` builds a macOS app and runs on macOS only (this machine is ${this.hostPlatform()}).`,
      );
    }
    const target = options.target ?? native;
    if (target !== native) {
      throw new AlephaError(
        `\`alepha compile --desktop\` targets this Mac only (${native}), not '${target}'. Run \`alepha compile --desktop\` without --target, on a Mac of the architecture you want.`,
      );
    }
    if (!options.config || typeof options.config !== "object") {
      throw new AlephaError(
        "`alepha compile --desktop` needs a top-level `desktop: { name, identifier }` in alepha.config.ts.",
      );
    }
    await this.assertBunSlice(dist, bunEntry);
    await this.assertNoExternals(dist);
    const adapter = await this.desktopAdapters.resolve(options.root);
    const config = await adapter.preflight({
      root: options.root,
      config: options.config,
      target,
    });
    const runtimes = options.runtimes ?? (await this.declaredRuntimes(dist));

    const stage = this.fs.join(
      options.root,
      "node_modules",
      ".alepha",
      "desktop-stage",
    );
    const stagedDist = this.fs.join(stage, "dist");
    await this.fs.rm(stage, { recursive: true, force: true });
    try {
      await this.fs.mkdir(stage, { recursive: true });
      await this.fs.cp(dist, stagedDist, { recursive: true });
      await this.embedPublicFiles(
        stagedDist,
        publicDir,
        options.builtAt ?? this.dateTime.nowMillis(),
        bunEntry,
      );
      const entries = await adapter.writeEntries({ dist: stagedDist, config });
      await this.shell.run(
        this.buildDesktopCompileCommand(
          options.name,
          target,
          options.minify ?? true,
          entries,
        ),
        { root: stagedDist },
      );
      const staged = await adapter.assemble({
        root: options.root,
        stage,
        dist: stagedDist,
        binary: this.fs.join(stagedDist, options.name),
        name: options.name,
        config,
      });

      const artifact = this.fs.join(dist, staged.split("/").pop() ?? "");
      await this.fs.rm(artifact, { recursive: true, force: true });
      await this.fs.cp(staged, artifact, { recursive: true });
      await this.cleanupPreCompileArtifacts(dist, publicDir, runtimes);
      this.log.info(`Desktop app → ${artifact}`);
      return artifact;
    } finally {
      await this.fs.rm(stage, { recursive: true, force: true });
    }
  }

  /**
   * The `bun build --compile` invocation for a desktop app: the shell is the
   * main entry, the supervisor and the server Worker bootstrap are embedded
   * beside it. An argv array, never a parsed string: nothing here is
   * re-split on a space.
   */
  protected buildDesktopCompileCommand(
    name: string,
    target: string,
    minify: boolean,
    entries: string[],
  ): string[] {
    return [
      "bun",
      "build",
      "--compile",
      `--target=${target}`,
      ...(minify ? ["--minify"] : []),
      `--outfile=${name}`,
      ...entries,
    ];
  }

  /**
   * The machine's platform. A method, so a spec can play another one.
   */
  protected hostPlatform(): string {
    return process.platform;
  }

  /**
   * The machine's architecture. A method, so a spec can play another one.
   */
  protected hostArch(): string {
    return process.arch;
  }

  /**
   * The Bun target triple when the caller names none: this machine.
   *
   * ⚠️ **A caller that is not targeting this machine must say so.** `alepha
   * image` always passes `linux: true`, because an image runs Linux whatever
   * the machine that built it, and the libc, because a Bun `--compile` binary
   * is dynamically linked and the triple picks its interpreter. Getting either
   * wrong produces a container that exits immediately with
   * `exec /app/app: no such file or directory`, which names a file that is
   * right there.
   */
  public defaultBunTarget(
    options: { linux?: boolean; musl?: boolean } = {},
  ): string {
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

    // musl is a SUFFIX on the linux triple, never a platform of its own, so
    // asking for it is also asking for linux.
    const linux = options.linux || options.musl;
    if (!arch || (!linux && !platform)) {
      throw new AlephaError(
        `No Bun target for '${process.platform}-${process.arch}'. Pass --target with an explicit Bun triple.`,
      );
    }

    if (!linux) {
      return `bun-${platform}-${arch}`;
    }
    return options.musl ? `bun-linux-${arch}-musl` : `bun-linux-${arch}`;
  }

  /**
   * The `bun build --compile` invocation. Runs from `<root>/<dist>`, so the
   * entry path stays relative and the binary lands beside the migrations.
   */
  protected buildCompileCommand(
    name: string,
    target: string,
    minify: boolean,
    entry: string,
  ): string {
    return [
      "bun build",
      "--compile",
      `--target=${target}`,
      minify ? "--minify" : "",
      `--outfile=${name}`,
      entry,
    ]
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Every slice the build declared, from the manifest.
   *
   * ⚠️ **It has to be every one, not just the compiled slice.** Compiling
   * consumes `dist/`: `server/` and `public/` both go, because the binary
   * carries them. A sibling `index.node.js` left behind then imports a
   * `server/node/` that is no longer there — a file that looks runnable,
   * is not, and fails at `node index.node.js` with a resolution error rather
   * than anything naming the compile that removed its chunks.
   *
   * The manifest is the discovery mechanism for slices, so it is what is read.
   * An artifact without one falls back to the bun slice alone, which is the
   * only slice this command is certain exists.
   */
  protected async declaredRuntimes(dist: string): Promise<BuildRuntime[]> {
    try {
      const manifest = await this.fs.readJsonFile<{
        runtimes?: Array<{ runtime: BuildRuntime }>;
      }>(this.fs.join(dist, "manifest.json"));
      const declared = manifest.runtimes?.map((slice) => slice.runtime);
      if (declared?.length) {
        return declared;
      }
    } catch {}
    return ["bun"];
  }

  /**
   * Refuse a `dist/` with no bun slice, by name.
   *
   * ⚠️ **Never a fallback to whatever slice is there.** The node slice runs
   * under Bun, so compiling it would succeed and produce a working binary —
   * built from the generic bundle, with every Bun-native API and every
   * dependency the bun conditions exist to drop still in it. A binary that
   * works is the worst possible failure here, because nothing ever says the
   * slice was wrong.
   */
  protected async assertBunSlice(dist: string, entry: string): Promise<void> {
    if (await this.fs.exists(this.fs.join(dist, entry))) {
      return;
    }
    throw new AlephaError(
      `\`alepha compile\` needs the bun slice, and \`${entry}\` is not in the build. ` +
        "Rebuild with `alepha build --runtime bun` (or add `bun` to `build.runtime`).",
    );
  }

  /**
   * Compiling requires fully-bundled output. If Vite left anything in
   * `dist/package.json`'s `dependencies`, fail loudly so the user can
   * either bundle the dep or not compile.
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
        `Cannot compile: the following dependencies were not bundled by Vite: ${names.join(", ")}. ` +
          "All dependencies must be bundleable to produce a single-binary build.",
      );
    }
  }

  /**
   * Append the embedding to the bun slice's entry wrapper: one file import per public
   * file, in a stable order, and the map the app reads at boot. Dot files
   * are left out, as the disk source leaves them out. An app with no client
   * has nothing to embed.
   */
  protected async embedPublicFiles(
    dist: string,
    publicDir: string,
    builtAt: number,
    entry: string,
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

    const indexPath = this.fs.join(dist, entry);
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
    runtimes: BuildRuntime[],
  ): Promise<void> {
    // `server/` whole, and EVERY slice's entry wrapper — not just the compiled
    // one. A multi-slice build that also compiles leaves the other slices
    // beside the binary otherwise: megabytes of bundle the binary already
    // carries, and an `index.node.js` an operator could plausibly run instead
    // of the binary they were given.
    const entries = runtimes.map((runtime) =>
      this.slices.entryFileName(runtime),
    );
    for (const target of ["server", ...entries, "package.json", publicDir]) {
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
