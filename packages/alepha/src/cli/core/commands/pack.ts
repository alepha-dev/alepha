import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Pack the workspace into a deployable `tar.gz`.
 *
 * The tar contains everything a remote runner (Alepha Rocket, or any
 * `alepha platform <op> --prebuilt` consumer) needs to deploy the app:
 *
 *   dist/                 pre-built output (incl. manifest.json)
 *   migrations/           SQL files (if present)
 *
 * No source, no `alepha.config.ts`, no `package.json` — the deploy
 * side reads everything from `dist/manifest.json` and never touches
 * source. Excludes: `node_modules`, `.DS_Store`, macOS AppleDouble
 * (`._*`), `.alepha` build cache, `e2e`, `playwright-report`,
 * `coverage`.
 *
 * Output name: `<project-name>-<tag>.tar.gz` (default tag
 * "latest"). Project name comes from `package.json.name`. Naming
 * mirrors Docker tags — same artifact, different tag = different
 * file.
 */
export class PackCommand {
  protected readonly log = $logger();

  /**
   * Make a package name safe to use as a filename.
   *
   * A scoped name like `@acme/app` carries a path separator, so the archive
   * path pointed into a directory that does not exist and tar failed.
   * `@acme/app` → `acme-app`.
   *
   * `platform-lib`'s `NamingService` does the same thing for cloud resource
   * names, but `cli/core` must not depend on `platform-lib` — the dependency
   * runs the other way.
   */
  protected slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);

  public readonly pack = $command({
    name: "pack",
    description:
      "Pack the workspace into a deployable tar.gz (for `alepha platform --prebuilt` consumers like Alepha Rocket).",
    flags: z.object({
      tag: z
        .text({
          aliases: ["t"],
          description:
            "Tag suffix for the artifact name (Docker-style). Defaults to `latest` → `<project>-latest.tar.gz`. Pass a real version like `0.0.2` for a pinned artifact.",
        })
        .optional(),
      output: z
        .text({
          aliases: ["o"],
          description:
            "Output directory for the tar.gz (default: current dir).",
        })
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const pkgPath = this.fs.join(root, "package.json");
      let project: string;
      try {
        const pkg = await this.fs.readJsonFile<{ name?: string }>(pkgPath);
        if (!pkg.name) {
          throw new AlephaError(
            'Missing "name" in package.json — `alepha pack` needs it for the artifact filename.',
          );
        }
        project = pkg.name;
      } catch (err) {
        if (err instanceof AlephaError) throw err;
        throw new AlephaError(
          `Could not read package.json at ${pkgPath}. Run \`alepha pack\` from a workspace directory.`,
        );
      }

      const tag = flags.tag ?? "latest";
      const outputDir = flags.output ?? root;
      // Slugified: a scoped name like `@acme/app` carries a path separator,
      // so the archive path pointed into a directory that does not exist and
      // tar failed. `@acme/app` → `acme-app`.
      const filename = `${this.slugify(project)}-${tag}.tar.gz`;
      const outputPath = this.fs.join(outputDir, filename);

      // Include list: just `dist/` + `migrations/`. Everything else
      // (src, alepha.config.ts, tsconfig.json, package.json) is
      // dev-time scaffolding — the deploy side reads
      // `dist/manifest.json` for project/env/resources and never
      // touches source.
      const candidates = ["dist", "migrations"];
      const includes: string[] = [];
      for (const candidate of candidates) {
        if (await this.fs.exists(this.fs.join(root, candidate))) {
          includes.push(candidate);
        }
      }

      if (!includes.includes("dist")) {
        throw new AlephaError(
          "dist/ missing — run `alepha build --target=cloudflare` before `alepha pack`.",
        );
      }
      const manifestPath = this.fs.join(root, "dist", "manifest.json");
      if (!(await this.fs.exists(manifestPath))) {
        throw new AlephaError(
          `dist/manifest.json missing — required for prebuilt deploys. Rebuild with the current alepha version (\`alepha build --target=cloudflare\`).`,
        );
      }

      // macOS sets COPYFILE_DISABLE=0 by default; tar will then include
      // AppleDouble `._*` files. Force it off here so the tarball is
      // portable. Also pass explicit excludes for `node_modules`,
      // `.DS_Store`, etc. — they slip in via `dist/`.
      const excludes = [
        "node_modules",
        ".DS_Store",
        "._*",
        ".alepha",
        "e2e",
        "playwright-report",
        "test-results",
        "coverage",
      ]
        .map((p) => `--exclude='${p}'`)
        .join(" ");

      const tarCmd = `tar -czf '${outputPath}' ${excludes} ${includes.map((p) => `'${p}'`).join(" ")}`;
      // Wrap in `sh -c` so the env-var assignment is interpreted by the
      // shell instead of being parsed as the binary name. COPYFILE_DISABLE
      // suppresses macOS AppleDouble (`._*`) entries that tar otherwise
      // emits when running on HFS+/APFS.
      const cmd = `sh -c "COPYFILE_DISABLE=1 ${tarCmd}"`;

      await run({
        name: `pack → ${filename}`,
        handler: async () => {
          await this.shell.run(cmd, { root });
        },
      });

      this.log.info(`Packed ${filename} → ${outputPath}`);
    },
  });
}
