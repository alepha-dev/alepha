import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

export interface WorkspacePackOptions {
  /**
   * Workspace directory holding `dist/` and, when the app has one,
   * `migrations/`. Everything the archive contains is resolved from here, and
   * `tar` runs with it as its working directory.
   */
  root: string;

  /**
   * Project name for the artifact filename.
   *
   * Taken verbatim when given, so a caller that passes it can build the same
   * filename without re-implementing {@link WorkspacePacker.slugify}. That
   * second derivation is exactly what let `pack` write one file while
   * `BayAdapter` looked for another. Omitted, the `package.json` `name` is
   * read and slugified.
   */
  name?: string;

  /**
   * Tag suffix, Docker-style. Defaults to `latest`.
   */
  tag?: string;

  /**
   * Directory the `tar.gz` is written to. Defaults to {@link root}.
   */
  output?: string;

  /**
   * Progress reporting, when the caller has a runner to lend.
   *
   * Optional because the caller decides whether the tar deserves a line of
   * its own: `alepha pack` is the whole command so it does, while
   * `lore artifacts push` packs as one step among several.
   */
  run?: RunnerMethod;
}

export interface WorkspacePackResult {
  /**
   * `<project>-<tag>.tar.gz`, the name the archive was written under.
   */
  filename: string;

  /**
   * Absolute path of the archive, i.e. {@link WorkspacePackOptions.output}
   * joined with {@link WorkspacePackResult.filename}.
   */
  outputPath: string;
}

/**
 * Pack a built workspace into a deployable `tar.gz`.
 *
 * The tar contains everything a remote runner (Alepha Rocket, or any
 * `alepha platform <op> --prebuilt` consumer) needs to deploy the app:
 *
 *   dist/                 pre-built output (incl. manifest.json)
 *   migrations/           SQL files (if present)
 *
 * No source, no `alepha.config.ts`, no `package.json` — the deploy side reads
 * everything from `dist/manifest.json` and never touches source.
 *
 * ## ⚠️ Why this is a service and not just `PackCommand`
 *
 * `Alepha.inject` registers the module that DECLARES a service, through a
 * `[MODULE]` back-reference. So `$inject(PackCommand)` from outside
 * `alepha/cli` does not pull in one command: it registers `AlephaCli` entire,
 * and the injecting binary grows a `build`, a `dev`, a `db` and a `verify` it
 * never asked for. Measured, before this service existed: `AlephaCommand`
 * plus `inject(PackCommand)` reported 25 commands.
 *
 * This class lives in `AlephaCliServices`, which is command-free, so a caller
 * that wants to pack can inject packing rather than the whole CLI.
 */
export class WorkspacePacker {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);

  /**
   * What an explicit name may contain.
   *
   * It lands verbatim in a path, so a separator or a parent reference would
   * write the archive outside the output directory. Deliberately the same
   * shape Bay validates an app key against, so the platform name it hands
   * over always passes.
   */
  protected readonly namePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

  /**
   * Include list: just `dist/` + `migrations/`. Everything else (src,
   * alepha.config.ts, tsconfig.json, package.json) is dev-time scaffolding.
   */
  protected static readonly CANDIDATES = ["dist", "migrations"];

  /**
   * Paths that slip in via `dist/` and must not reach the archive.
   */
  protected static readonly EXCLUDES = [
    "node_modules",
    ".DS_Store",
    "._*",
    ".alepha",
    "e2e",
    "playwright-report",
    "test-results",
    "coverage",
  ];

  /**
   * Make a package name safe to use as a filename.
   *
   * A scoped name like `@acme/app` carries a path separator, so the archive
   * path pointed into a directory that does not exist and tar failed.
   * `@acme/app` → `acme-app`.
   *
   * Public, and the only copy: a caller that predicts the filename in order
   * to read the archive back has to slugify the same way, and the two copies
   * that used to exist were held together by a comment.
   *
   * `platform-lib`'s `NamingService` does the same thing for cloud resource
   * names, but `cli/core` must not depend on `platform-lib` — the dependency
   * runs the other way.
   */
  public slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Write `<project>-<tag>.tar.gz` and say where it landed.
   */
  public async pack(
    options: WorkspacePackOptions,
  ): Promise<WorkspacePackResult> {
    const { root } = options;
    const project = await this.resolveName(root, options.name);
    const tag = options.tag ?? "latest";
    const outputDir = options.output ?? root;
    const filename = `${project}-${tag}.tar.gz`;
    const outputPath = this.fs.join(outputDir, filename);

    const includes = await this.resolveIncludes(root);

    // macOS sets COPYFILE_DISABLE=0 by default; tar will then include
    // AppleDouble `._*` files. Force it off here so the tarball is
    // portable. Also pass explicit excludes for `node_modules`,
    // `.DS_Store`, etc. — they slip in via `dist/`.
    const excludes = WorkspacePacker.EXCLUDES.map(
      (p) => `--exclude='${p}'`,
    ).join(" ");

    const tarCmd = `tar -czf '${outputPath}' ${excludes} ${includes.map((p) => `'${p}'`).join(" ")}`;
    // Wrap in `sh -c` so the env-var assignment is interpreted by the
    // shell instead of being parsed as the binary name. COPYFILE_DISABLE
    // suppresses macOS AppleDouble (`._*`) entries that tar otherwise
    // emits when running on HFS+/APFS.
    const cmd = `sh -c "COPYFILE_DISABLE=1 ${tarCmd}"`;

    if (options.run) {
      await options.run({
        name: `pack → ${filename}`,
        handler: async () => {
          await this.shell.run(cmd, { root });
        },
      });
    } else {
      await this.shell.run(cmd, { root });
    }

    return { filename, outputPath };
  }

  /**
   * The name the archive is filed under.
   *
   * An explicit one is taken verbatim and only validated; the `package.json`
   * fallback is slugified, because a scoped name is not a filename.
   */
  protected async resolveName(
    root: string,
    name: string | undefined,
  ): Promise<string> {
    if (name !== undefined) {
      if (!this.namePattern.test(name)) {
        throw new AlephaError(
          `Invalid --name "${name}": the artifact filename is built from it, so it must be a single filename segment matching ${this.namePattern}.`,
        );
      }
      return name;
    }

    const pkgPath = this.fs.join(root, "package.json");
    try {
      const pkg = await this.fs.readJsonFile<{ name?: string }>(pkgPath);
      if (!pkg.name) {
        throw new AlephaError(
          'Missing "name" in package.json: `alepha pack` needs it for the artifact filename. Pass `--name` to set it explicitly.',
        );
      }
      return this.slugify(pkg.name);
    } catch (err) {
      if (err instanceof AlephaError) throw err;
      throw new AlephaError(
        `Could not read package.json at ${pkgPath}. Run \`alepha pack\` from a workspace directory.`,
      );
    }
  }

  /**
   * What of `dist/` and `migrations/` exists, having refused the two shapes
   * that pack cleanly and then fail at deploy time.
   */
  protected async resolveIncludes(root: string): Promise<string[]> {
    const includes: string[] = [];
    for (const candidate of WorkspacePacker.CANDIDATES) {
      if (await this.fs.exists(this.fs.join(root, candidate))) {
        includes.push(candidate);
      }
    }

    if (!includes.includes("dist")) {
      throw new AlephaError(
        "dist/ missing — run `alepha build` before `alepha pack`.",
      );
    }
    const manifestPath = this.fs.join(root, "dist", "manifest.json");
    if (!(await this.fs.exists(manifestPath))) {
      throw new AlephaError(
        `dist/manifest.json missing — required for prebuilt deploys. Rebuild with the current alepha version (\`alepha build\`).`,
      );
    }

    // An app that declares a database but ships no migrations is packed
    // silently and then fails at runtime with missing tables, far from the
    // cause. The mismatch is knowable here, so it is refused here.
    //
    // It is a real shape, not a hypothetical: in a monorepo the migrations
    // often live in a shared package (`packages/server/migrations`) while the
    // deployable workspace is `apps/<name>`, and a self-hosted runtime
    // resolves `migrations/<dialect>` relative to its own working directory —
    // so only what `pack` includes ever exists.
    const manifest = await this.fs.readJsonFile<{
      resources?: { hasDatabase?: boolean };
    }>(manifestPath);
    if (manifest.resources?.hasDatabase && !includes.includes("migrations")) {
      throw new AlephaError(
        "This app declares a database but there is no `migrations/` next to " +
          "`dist/`, so the artifact would deploy with no schema and fail at " +
          "runtime with missing tables.\n\n" +
          "Generate them with `alepha db migrations create`, or — if they live " +
          "in another workspace — make them reachable from this one before " +
          "packing.",
      );
    }

    return includes;
  }
}
