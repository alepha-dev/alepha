import { $inject, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Pack the workspace into a deployable `tar.gz`.
 *
 * The tar contains everything a remote runner (Alepha Rocket, or any
 * `alepha platform <op>` consumer of pre-built artifacts) needs to
 * deploy the app:
 *
 *   src/                  source — needed for `analyze app` (introspection)
 *   dist/                 pre-built output (skip with --no-build to reuse)
 *   migrations/           SQL files (if present)
 *   alepha.config.ts      workspace config
 *   package.json
 *   tsconfig.json         (if present)
 *
 * Excludes: `node_modules`, `.DS_Store`, macOS AppleDouble (`._*`),
 * `.alepha` build cache, `e2e`, `playwright-report`, `coverage`.
 *
 * Output name: `<project-name>-<version>.tar.gz` (default version
 * "latest"). Project name comes from `package.json.name`.
 */
export class PackCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);

  public readonly pack = $command({
    name: "pack",
    description:
      "Pack the workspace into a deployable tar.gz (for `alepha platform --prebuilt` consumers like Alepha Rocket).",
    flags: t.object({
      version: t.optional(
        t.text({
          aliases: ["v"],
          description:
            "Version suffix for the artifact name. Defaults to `latest` → `<project>-latest.tar.gz`. Pass a real version like `0.0.2` for a pinned artifact.",
        }),
      ),
      output: t.optional(
        t.text({
          aliases: ["o"],
          description:
            "Output directory for the tar.gz (default: current dir).",
        }),
      ),
      build: t.optional(
        t.boolean({
          description:
            "Run `alepha build --target=cloudflare` first to refresh `dist/`. Default: assume `dist/` is up to date. Pass `--build` to rebuild.",
        }),
      ),
    }),
    handler: async ({ flags, root, run }) => {
      if (flags.build) {
        await run("alepha build --target=cloudflare");
      }

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

      const version = flags.version ?? "latest";
      const outputDir = flags.output ?? root;
      const filename = `${project}-${version}.tar.gz`;
      const outputPath = this.fs.join(outputDir, filename);

      // Build the include list dynamically — only include dirs/files
      // that actually exist so tar doesn't error.
      const candidates = [
        "src",
        "dist",
        "migrations",
        "alepha.config.ts",
        "package.json",
        "tsconfig.json",
      ];
      const includes: string[] = [];
      for (const candidate of candidates) {
        if (await this.fs.exists(this.fs.join(root, candidate))) {
          includes.push(candidate);
        }
      }

      if (!includes.includes("package.json")) {
        throw new AlephaError("package.json missing in workspace root.");
      }
      if (!includes.includes("alepha.config.ts")) {
        throw new AlephaError("alepha.config.ts missing in workspace root.");
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
