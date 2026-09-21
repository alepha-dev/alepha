import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import { ArchiveCompressor } from "./ArchiveCompressor.ts";

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
   * Directory the archive is written to. Defaults to {@link root}.
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
   * `<project>-<tag>.tar.zst`, the name the archive was written under.
   */
  filename: string;

  /**
   * Absolute path of the archive, i.e. {@link WorkspacePackOptions.output}
   * joined with {@link WorkspacePackResult.filename}.
   */
  outputPath: string;

  /**
   * The sibling `.maps.tar.zst`, when the build produced any source map.
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
 * Pack a built workspace into a deployable `tar.zst`.
 *
 * The tar contains everything a remote runner (Alepha Rocket, Alepha Bay, or
 * any `alepha platform <op> --prebuilt` consumer) needs to deploy the app:
 *
 *   public/               client bundle and prerendered HTML
 *   server/<runtime>/     one chunk directory per server slice
 *   index.<runtime>.js    one entry wrapper per slice
 *   manifest.json         what the build declared
 *   migrations/           SQL files (if present)
 *
 * ## ⚠️ The archive root is the CONTENTS, not a `dist/` wrapper
 *
 * `tar xf` yields `./public`, `./server`, `./index.node.js`, `./manifest.json`
 * and `./migrations` at the top. It used to yield `dist/` and `migrations/`,
 * and `manifest.entry` named the `dist` directory rather than a file.
 *
 * No compatibility alias is carried: Bay shipped its reader first, and every
 * artifact produced from here on has this shape. A consumer meeting the old
 * one should say so and ask for a redeploy, which is what Bay does.
 *
 * No source, no `alepha.config.ts`, no `package.json` — the deploy side reads
 * everything from `manifest.json` and never touches source.
 *
 * ## ⚠️ zstd, with a pinned window, and why that is not a detail
 *
 * A multi-slice artifact holds near-identical copies of the same bundle
 * megabytes apart. DEFLATE's match window is 32 KB, so gzip never sees the
 * second copy; zstd with long-range matching does, but only if its window is
 * large enough to hold both.
 *
 * Measured on Lore's node slice, duplicated (7.94 MB -> 15.88 MB raw):
 *
 * | | one slice | two slices | ratio |
 * | --- | --- | --- | --- |
 * | `gzip -9` | 1.72 MB | 3.44 MB | **2.00x** |
 * | zstd, default window | 1.45 MB | 2.88 MB | **1.99x** |
 * | zstd, pinned `windowLog` | 1.45 MB | 1.47 MB | **1.02x** |
 *
 * At the default window the dedup silently does not happen and the archive is
 * twice the size it should be. Nothing fails, which is the entire reason
 * {@link ArchiveCompressor.WINDOW_LOG} is pinned explicitly AND the ratio is
 * asserted in a spec: a pinned value alone drifts as apps outgrow it, and an
 * assertion alone never sets it.
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
  protected readonly compressor = $inject(ArchiveCompressor);

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
   * Include list: the CONTENTS of `dist/`, plus `migrations/` as a directory.
   *
   * ⚠️ These are no longer two equivalent entries. `dist` is unwrapped — its
   * contents land at the archive root — while `migrations` keeps its name,
   * because a deployer looks for `migrations/<dialect>` relative to the root.
   * {@link tarArguments} is where that asymmetry is expressed; this list only
   * says what to look for.
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
   * Write `<project>-<tag>.tar.zst` and say where it landed.
   */
  public async pack(
    options: WorkspacePackOptions,
  ): Promise<WorkspacePackResult> {
    const { root } = options;
    const project = await this.resolveName(root, options.name);
    const tag = options.tag ?? "latest";
    const outputDir = options.output ?? root;
    const filename = `${project}-${tag}.tar.zst`;
    const outputPath = this.fs.join(outputDir, filename);

    const includes = await this.resolveIncludes(root);

    const write = async () => {
      await this.writeArchive(
        root,
        outputPath,
        this.tarArguments(root, includes),
      );
    };

    if (options.run) {
      await options.run({ name: `pack → ${filename}`, handler: write });
    } else {
      await write();
    }

    const maps = await this.packMaps(root, outputDir, project, tag);

    return { filename, outputPath, maps };
  }

  /**
   * The `tar` operands that put the build's contents at the archive root.
   *
   * ⚠️ **Repeated `-C` is the whole trick**, and it is positional: `tar`
   * changes directory where the option appears and the operands after it are
   * resolved from there. So `-C <root>/dist .` writes `./public`,
   * `./index.node.js` and the rest at the top, while a following
   * `-C <root> migrations` steps back out and adds that one as a named
   * directory. Both GNU and BSD tar read it this way.
   *
   * The alternative — `tar -C dist .` then a second archive appended — needs
   * `-r`, which no compressed stream supports.
   */
  protected tarArguments(root: string, includes: string[]): string {
    const parts: string[] = [];
    for (const include of includes) {
      if (include === "dist") {
        // Unwrapped: its contents ARE the archive root.
        parts.push(`-C '${this.fs.join(root, include)}' .`);
      } else {
        // Named, because a deployer looks for `migrations/<dialect>`.
        parts.push(`-C '${root}' '${include}'`);
      }
    }
    return parts.join(" ");
  }

  /**
   * `tar -cf` to a temporary file, then zstd it into place.
   *
   * ⚠️ **Not `tar --zstd`.** That needs GNU tar 1.31+ on every machine that
   * packs, which macOS does not have, and it exposes no way to set
   * `windowLog` — which would make {@link ArchiveCompressor.WINDOW_LOG} unenforceable and
   * the dedup silently absent.
   *
   * ⚠️ **Not an in-memory buffer either.** Lore's uncompressed archive is
   * 61 MB and every slice added is another 30, so the tar goes to disk and is
   * streamed through the compressor. The temp file is removed whether the
   * compression succeeds or throws.
   */
  protected async writeArchive(
    root: string,
    outputPath: string,
    operands: string,
    options: { exclude?: boolean } = {},
  ): Promise<void> {
    /*
      macOS sets COPYFILE_DISABLE=0 by default; tar will then include
      AppleDouble `._*` files. Force it off here so the tarball is portable.
      The explicit excludes cover `node_modules`, `.DS_Store` and friends,
      which slip in via `dist/`.

      ⚠️ **Opt-out, because `*.map` is on that list.** The maps archive exists
      precisely to carry what the exclusion removes, so applying the same
      excludes to it produces a valid, empty archive: 17 bytes that read as
      "this build had no source maps". Nothing fails, and the diagnostic the
      exclusion was only safe because of quietly stops existing.
    */
    const excludes =
      options.exclude === false
        ? ""
        : WorkspacePacker.EXCLUDES.map((p) => `--exclude='${p}'`).join(" ");

    const tarPath = `${outputPath}.tar`;
    // Wrap in `sh -c` so the env-var assignment is interpreted by the
    // shell instead of being parsed as the binary name.
    await this.shell.run(
      `sh -c "COPYFILE_DISABLE=1 tar -cf '${tarPath}' ${excludes} ${operands}"`,
      { root },
    );

    try {
      await this.compressor.compress(tarPath, outputPath);
    } finally {
      await this.fs.rm(tarPath, { force: true });
    }
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
    outputDir: string,
    project: string,
    tag: string,
  ): Promise<WorkspacePackResult["maps"]> {
    // `dist` only. Maps are a build output, `migrations/` is SQL, and
    // searching a tree that cannot contain one is a shell call for nothing.
    const distDir = this.fs.join(root, "dist");
    const listed = await this.shell.run(
      `sh -c "find . -name '*.map' -type f -print"`,
      { root: distDir, capture: true },
    );

    const paths = String(listed ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (paths.length === 0) {
      return undefined;
    }

    const filename = `${project}-${tag}.maps.tar.zst`;
    const outputPath = this.fs.join(outputDir, filename);
    // Beside the archive rather than in a temp directory: `output` is already
    // the place this call is allowed to write, and a list file left behind by
    // a crash is then visible next to what it describes.
    const listPath = this.fs.join(outputDir, `${filename}.list`);
    await this.fs.writeFile(listPath, `${paths.join("\n")}\n`);

    try {
      // ⚠️ Rooted at `dist` like the main archive, so a map lands at
      // `server/node/abc.js.map` beside the `server/node/abc.js` it describes.
      // Rooted anywhere else, every path in it is off by one directory and
      // nothing that symbolicates can line the two up.
      await this.writeArchive(distDir, outputPath, `-T '${listPath}'`, {
        // ⚠️ `*.map` is an exclude, and this archive is nothing BUT maps.
        exclude: false,
      });
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
