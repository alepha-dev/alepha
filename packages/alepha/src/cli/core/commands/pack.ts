import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { WorkspacePacker } from "../services/WorkspacePacker.ts";

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
 * "latest"). Project name comes from `--name` when the caller passes
 * one, otherwise from `package.json.name`. Naming mirrors Docker tags:
 * same artifact, different tag = different file.
 *
 * ## ⚠️ The work is in {@link WorkspacePacker}, not here
 *
 * Everything below is flag parsing. Packing lives in a service registered by
 * the command-free `AlephaCliServices`, because injecting a command registers
 * the module that declares it: a caller reaching for `PackCommand` was
 * registering the whole of `AlephaCli` and growing a `build`, a `dev` and a
 * `verify` it never asked for.
 */
export class PackCommand {
  protected readonly log = $logger();
  protected readonly packer = $inject(WorkspacePacker);

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
      name: z
        .text({
          aliases: ["n"],
          description:
            "Project name for the artifact filename (default: `package.json` `name`, slugified). `alepha platform` passes the deploy-side project name, which `platform({ name })` is free to make differ from the package name.",
        })
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const { filename, outputPath } = await this.packer.pack({
        root,
        name: flags.name,
        tag: flags.tag,
        output: flags.output,
        run,
      });

      this.log.info(`Packed ${filename} → ${outputPath}`);
    },
  });
}
