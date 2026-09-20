import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { WorkspaceCompiler } from "../services/WorkspaceCompiler.ts";

/**
 * Compile `./dist` into one executable, its `public/` files inside it.
 *
 *     alepha build --runtime bun
 *     alepha compile --out my-app
 *
 * ## Why this is a command and not a build flag
 *
 * It used to be `alepha build --compile`, living in `buildOptions` and
 * reaching back into the build to constrain `target` to `bare` or `docker`. A
 * build option that constrains other build options is a knot, and untying it
 * is what let `--target` be retired at all.
 *
 * Standalone it is three sentences: take the bun slice, embed `public/`, emit
 * a binary.
 *
 * ## ⚠️ `./dist` only
 *
 * It never unpacks an archive. If you have one, unpack it first. The build
 * that produced `dist/` is the one thing that can say which slices are in it,
 * and an archive would need decompressing before this could even look.
 *
 * ## The options are flags, and there is no `compile:` config key
 *
 * Three settings — the binary name, the Bun triple, minification — and a key
 * nobody sets is worse than three flags. Measured before deciding: no app in
 * this monorepo set `build.compile`, so the rename this would have cost
 * downstream is zero, and the reason to keep it in config (repeating it on
 * every invocation) never applied. `alepha image` drives the triple itself
 * rather than reading one from config, which was the other candidate reason.
 */
export class CompileCommand {
  protected readonly log = $logger();
  protected readonly compiler = $inject(WorkspaceCompiler);

  public readonly compile = $command({
    name: "compile",
    description:
      "Compile ./dist into one executable with its public/ files inside it. Needs a bun slice: `alepha build --runtime bun`.",
    flags: z.object({
      out: z
        .text({
          aliases: ["o"],
          description:
            "File name of the binary inside dist/ (default: `app`). `--out loom` produces `dist/loom`.",
        })
        .optional(),
      target: z
        .text({
          aliases: ["t"],
          description:
            "Bun target triple, e.g. `bun-linux-arm64-musl` (default: this machine). ⚠️ A Bun binary is not fully static — the triple picks the libc — so a binary meant for a musl container must say so.",
        })
        .optional(),
      minify: z
        .boolean()
        .describe("Minify the compiled output (default: on).")
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const name = flags.out ?? "app";
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
        throw new (await import("alepha")).AlephaError(
          `Invalid binary name '${name}': use lowercase letters, digits, '.', '_' and '-', starting with a letter or a digit.`,
        );
      }

      const target = flags.target ?? this.compiler.defaultBunTarget();

      let binary = "";
      await run({
        name: `compile → ${name} (${target})`,
        handler: async () => {
          binary = await this.compiler.compile({
            root,
            name,
            target,
            minify: flags.minify ?? true,
          });
        },
      });

      this.log.info(`Compiled ${name} → ${binary}`);
    },
  });
}
