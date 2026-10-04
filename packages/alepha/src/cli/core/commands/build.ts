import { $inject, z } from "alepha";
import { $command } from "alepha/command";

import type { BuildRuntimeDeclaration } from "../atoms/buildOptions.ts";
import { BuildPipeline } from "../services/BuildPipeline.ts";
import { BuildSlices } from "../services/BuildSlices.ts";

export class BuildCommand {
  protected readonly pipeline = $inject(BuildPipeline);
  protected readonly slices = $inject(BuildSlices);

  public readonly build = $command({
    name: "build",
    mode: "production",
    description: "Build the project for production",
    flags: z.object({
      stats: z
        .union([z.boolean(), z.enum(["json"])])
        .describe("Generate build stats report")
        .optional(),
      runtime: z
        .text()
        .meta({ aliases: ["r"] })
        .describe(
          "Runtimes to link the server for, comma-separated and in order: node, bun, workerd. The first is the primary: what the manifest names, what dist/package.json points at, and what a deployer spawns. e.g. --runtime node,workerd. `static` declares an app with no server at all.",
        )
        .optional(),
      inspect: z
        .boolean()
        .describe(
          "Bundle alepha/inspector into the server so devtools can inspect this production build. It stays off until the process runs with ALEPHA_INSPECT=1; a build without the flag carries none of it. Not on workerd.",
        )
        .optional(),
      prebuilt: z
        .boolean()
        .describe(
          "Skip the bundle steps (Vite client/server + asset compression). Only regenerates target-specific deploy config (e.g. wrangler.jsonc). Use when `dist/` is already built and you just need the config refreshed.",
        )
        .optional(),
      ifStale: z
        .boolean()
        // Every other flag here is one word, so camelCase has no precedent to
        // follow and `--ifStale` reads badly. The alias is the spelling meant
        // to be used and written down; the key stays camelCase because that
        // is what the schema and `flags.ifStale` need.
        .meta({ aliases: ["if-stale"] })
        .describe(
          "Build only when `dist/` is missing or older than the sources it was built from (the app's own src/public/migrations plus every workspace dependency it bundles). Use in a pipeline that builds and then runs the build, so the second invocation is a no-op instead of a full rebuild.",
        )
        .optional(),
    }),
    handler: async ({ flags, run, root }) => {
      await this.pipeline.build({
        root,
        run,
        // The flag is a comma-separated list so one flag carries the order.
        // It replaces the declaration outright rather than merging with it:
        // a caller that names a set means that set, and a union would make
        // `--runtime workerd` silently also build whatever the config asked
        // for.
        runtime: this.slices.parseFlag(flags.runtime) as
          | BuildRuntimeDeclaration
          | undefined,
        stats: flags.stats,
        inspect: flags.inspect,
        prebuilt: flags.prebuilt,
        ifStale: flags.ifStale,
        // Whatever runs after the build in this process (a platform deploy)
        // reads the resolved runtime from the atom.
        persist: true,
      });
    },
  });
}
