import { $inject, $store, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/system";

import type { BuildRuntime } from "../atoms/buildOptions.ts";
import { imageOptions } from "../atoms/imageOptions.ts";
import type { BuildManifest } from "../schemas/buildManifest.ts";
import { BuildSlices } from "../services/BuildSlices.ts";
import { DockerImageBuilder } from "../services/DockerImageBuilder.ts";

/**
 * Build a container image from `./dist`.
 *
 *     alepha build
 *     alepha image
 *
 * ## ⚠️ It needs the docker CLI
 *
 * It shells out to `docker build`, so it cannot run in an in-process build
 * path — notably the one Lore's Worker deploy uses, which has no shell at all.
 * This is a local and CI command, and saying so here is cheaper than somebody
 * finding out from a deploy that cannot shell out.
 *
 * ## Generate once, then get out of the way
 *
 * No Dockerfile in the app directory: one is generated there, beside
 * `alepha.config.ts`. One already present: it is used untouched. The file is
 * meant to be committed and edited by hand, which is exactly why it is not
 * written into `dist/` — the build wipes that on every run, so a file living
 * there could never be either.
 *
 * A committed Dockerfile stops tracking the build the moment `engines.node`
 * moves, so its header records the manifest facts it came from and a later
 * run **warns** when they no longer match. Never fails: the file is the
 * author's after generation, and a hard failure would make an intentional
 * edit feel like a bug.
 *
 * ## Which slice
 *
 * The primary: the first declared runtime, read from the manifest. An image
 * runs one process from one entry point, and this is the same rule the
 * manifest and every deployer follow, so nothing here implements a preference
 * of its own.
 */
export class ImageCommand {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly builder = $inject(DockerImageBuilder);
  protected readonly slices = $inject(BuildSlices);
  protected readonly options = $store(imageOptions);

  public readonly image = $command({
    name: "image",
    description:
      "Build a container image from ./dist. Generates a Dockerfile in the app directory when there is none, and reuses yours when there is. Needs the docker CLI.",
    flags: z.object({
      tag: z
        .union([z.boolean(), z.text()])
        .meta({ aliases: ["t"] })
        .describe(
          "Image tag. `--tag` uses `latest`, `--tag=1.3.4` uses that version with the configured name, and `--tag=other/img:v1` is taken verbatim.",
        )
        .optional(),
      dockerfile: z
        .boolean()
        .describe(
          "Write the Dockerfile and stop, without building an image. Useful for committing the generated file before editing it.",
        )
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const manifest = await this.readManifest(root);
      const runtime = this.primaryRuntime(manifest);

      if (runtime === "static") {
        throw new AlephaError(
          "This artifact is a static site: it runs no process, so there is nothing for an image to start. Serve `dist/public` from any static host.",
        );
      }
      if (runtime === "workerd") {
        throw new AlephaError(
          "This artifact's primary slice is `workerd`, which only Cloudflare runs. Build a node or bun slice first (`alepha build --runtime node`), or declare it first in `build.runtime` so it becomes the primary.",
        );
      }

      await this.builder.run({
        root,
        distDir: "dist",
        runtime,
        image: this.options,
        build: flags.dockerfile ? undefined : (flags.tag ?? true),
        run,
      });
    },
  });

  /**
   * The artifact's own account of itself.
   *
   * ⚠️ Read rather than inferred from flags. The manifest is what the build
   * actually produced, and it is the only thing that can say which slices are
   * in `dist/` — this command never boots the app.
   */
  protected async readManifest(root: string): Promise<BuildManifest> {
    const path = this.fs.join(root, "dist", "manifest.json");
    try {
      return await this.fs.readJsonFile<BuildManifest>(path);
    } catch {
      throw new AlephaError(
        `Cannot read ${path}. \`alepha image\` reads ./dist — run \`alepha build\` first.`,
      );
    }
  }

  /**
   * The first declared runtime, which is what the image runs.
   */
  protected primaryRuntime(manifest: BuildManifest): BuildRuntime | "static" {
    return (
      manifest.runtimes?.[0]?.runtime ??
      manifest.runtime ??
      this.slices.primary([])
    );
  }
}
