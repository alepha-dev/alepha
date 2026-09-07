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

  /**
   * The sibling `.maps.tar.gz`, when the build produced any source map.
   *
   * Absent when it produced none, which is the honest answer and not an
   * error: a caller uploads a maps object only when there is one.
   */
  maps?: {
    filename: string;
    outputPath: string;
  };
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
   *
   * ⚠️ **`*.map` is here, so this changes what EVERY `alepha pack` produces**,
   * not only what Lore stores. Deliberate: no runtime reads a source map out
   * of a tarball, and Cloudflare treats them as a separate opt-in
   * (`upload_source_maps`). Measured on `apps/lore/dist`, 266 of 267 server JS
   * files had a sibling map and they were roughly 5 MB of a 6.4 MB gzipped
   * archive - a 4x on every push, every pull and every stored version.
   *
   * ⚠️ **They are not discarded**, which is the part that makes the exclusion
   * safe: {@link packMaps} writes them to a sibling archive in the same call,
   * so an error report stays symbolicable by whatever reads them later. Adding
   * a pattern here without a route for what it removes is how a diagnostic
   * quietly stops existing.
   *
   * The entries are `tar` arguments, expanded by `tar` and not by the shell -
   * each is single-quoted at the call site, so an unquoted `*.map` cannot be
   * expanded against the cwd first. `--exclude='*.map'` matches at any depth
   * in GNU and BSD tar alike.
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
    "*.map",
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

    const maps = await this.packMaps(root, includes, outputDir, project, tag);

    return { filename, outputPath, maps };
  }

  /**
   * The sibling archive holding every source map the build produced.
   *
   * ⚠️ **A separate object rather than a Sigil upload.** Nothing symbolicates
   * today, so uploading into Sigil would commit to a consumer that does not
   * exist and make a measured 4x size win wait on a feature nobody has scoped.
   * The artifact already IS its digest, so a sibling beside it needs no table,
   * no key and no lifecycle of its own: it is written and deleted with the
   * artifact row.
   *
   * Two shell calls rather than one, and both are deliberate. `find` first, so
   * a build with no maps produces no archive at all - an empty tarball would
   * be a stored object that says something false. Then `tar -T <list>` rather
   * than the paths as arguments, because a large build has thousands of maps
   * and an argument list has a ceiling; a newline-separated list file is
   * understood by GNU and BSD tar alike, where `--null -T -` is not.
   */
  protected async packMaps(
    root: string,
    includes: string[],
    outputDir: string,
    project: string,
    tag: string,
  ): Promise<WorkspacePackResult["maps"]> {
    if (includes.length === 0) {
      return undefined;
    }

    const targets = includes.map((p) => `'${p}'`).join(" ");
    const listed = await this.shell.run(
      `sh -c "find ${targets} -name '*.map' -type f -print"`,
      { root, capture: true },
    );

    const paths = String(listed ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (paths.length === 0) {
      return undefined;
    }

    const filename = `${project}-${tag}.maps.tar.gz`;
    const outputPath = this.fs.join(outputDir, filename);
    // Beside the archive rather than in a temp directory: `output` is already
    // the place this call is allowed to write, and a list file left behind by
    // a crash is then visible next to what it describes.
    const listPath = this.fs.join(outputDir, `${filename}.list`);
    await this.fs.writeFile(listPath, `${paths.join("\n")}\n`);

    try {
      await this.shell.run(
        `sh -c "COPYFILE_DISABLE=1 tar -czf '${outputPath}' -T '${listPath}'"`,
        { root },
      );
    } finally {
      await this.fs.rm(listPath, { force: true });
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
