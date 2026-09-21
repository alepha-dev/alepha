import { $inject, $store, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/system";

import type { BuildRuntime } from "../atoms/buildOptions.ts";
import { imageOptions } from "../atoms/imageOptions.ts";
import type { BuildManifest } from "../schemas/buildManifest.ts";
import { DockerImageBuilder } from "../services/DockerImageBuilder.ts";
import { WorkspaceCompiler } from "../services/WorkspaceCompiler.ts";

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
  protected readonly compiler = $inject(WorkspaceCompiler);
  protected readonly options = $store(imageOptions);

  /**
   * Bases that provide musl rather than glibc.
   *
   * ⚠️ **This is the decision the whole compiled image turns on, and getting
   * it wrong is not a build failure.** A Bun `--compile` binary is dynamically
   * linked and the target triple picks its interpreter: a glibc binary on a
   * musl base, or the reverse, produces a container that exits immediately
   * with `exec /app/app: no such file or directory` — an error naming a file
   * that plainly exists.
   *
   * So `alepha image` derives the triple from the BASE rather than inheriting
   * whatever `alepha compile` would default to, which is the host's libc and
   * is right for almost none of these.
   */
  protected readonly muslBases = ["alpine", "musl"];

  /**
   * Bases that carry no libc at all, and therefore cannot run a Bun binary.
   *
   * ⚠️ **Refused by name, because no triple fixes them.** Measured: a Bun
   * `--compile` binary is not static under either triple — the musl one needs
   * `ld-musl`, `libstdc++.so.6` and `libgcc_s.so.1`. `scratch` and
   * `distroless/static` have none of that, so an image built on one starts
   * nothing and says only "no such file or directory" about a file that is
   * right there.
   *
   * This WAS the default base until it was measured, which is why the refusal
   * names the working alternative rather than just saying no.
   */
  protected readonly libcFreeBases = ["scratch", "distroless/static"];

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
      compile: z
        .union([z.boolean(), z.text()])
        .meta({ aliases: ["c"] })
        .describe(
          "Compile the app to one binary first and ship an image holding nothing else. Needs a bun slice. `--compile name` names the binary.",
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

      const compiled = flags.compile
        ? await this.compileFirst(root, flags.compile, run)
        : undefined;

      await this.builder.run({
        root,
        distDir: "dist",
        // A compiled image runs a Bun binary whatever the manifest's primary
        // slice is, because `bun build --compile` is the only compiler there
        // is. The label and the base defaults follow that, not the manifest.
        runtime: compiled ? "bun" : runtime,
        compile: compiled,
        image: this.options,
        build: flags.dockerfile ? undefined : (flags.tag ?? true),
        run,
      });
    },
  });

  /**
   * Compile the bun slice into a binary, for an image holding nothing else.
   *
   * ⚠️ **The triple comes from the BASE IMAGE, not from the host.** See
   * {@link muslBases}: the triple picks the libc, and a mismatch produces a
   * container that exits immediately rather than a build that fails.
   */
  protected async compileFirst(
    root: string,
    flag: boolean | string,
    run: Parameters<typeof this.builder.run>[0]["run"],
  ): Promise<string> {
    const name = typeof flag === "string" ? flag : "app";
    // Named once, on the builder that also writes it into the Dockerfile: two
    // copies of this string would eventually disagree, and the symptom would
    // be a container that exits immediately with an error about nothing.
    const base = this.options.from ?? DockerImageBuilder.DEFAULT_COMPILE_BASE;
    this.assertBaseCanRunABinary(base);
    const musl = this.usesMusl(base);
    // ⚠️ `linux` always: an image runs Linux whatever machine built it, and
    // the host default would hand a macOS build a `bun-darwin-arm64` binary
    // that the container cannot execute.
    const target = this.compiler.defaultBunTarget({ linux: true, musl });

    await run({
      name: `compile → ${name} (${target})`,
      handler: async () => {
        await this.compiler.compile({
          root,
          name,
          target,
          // The image's own `COPY migrations` line handles them, and the
          // builder copies them into the context itself.
          migrations: false,
        });
      },
    });
    return name;
  }

  /**
   * Whether this base image wants a musl-targeted binary.
   *
   * Substring rather than exact match, because a base carries a tag and often
   * a registry: `alpine:3.20`, `oven/bun:alpine`. Anything unrecognised is
   * treated as glibc, which is what `debian`, `ubuntu` and every distroless
   * image but the alpine-flavoured ones are.
   */
  protected usesMusl(base: string): boolean {
    const lower = base.toLowerCase();
    return this.muslBases.some((known) => lower.includes(known));
  }

  /**
   * Refuse a base with no libc, naming why and what to use instead.
   *
   * @throws {AlephaError} when the base cannot run a dynamically linked binary
   */
  protected assertBaseCanRunABinary(base: string): void {
    const lower = base.toLowerCase();
    if (!this.libcFreeBases.some((known) => lower.includes(known))) {
      return;
    }
    throw new AlephaError(
      `\`${base}\` carries no libc, so it cannot run a compiled binary. ` +
        "A Bun `--compile` binary is dynamically linked whatever target it is " +
        "built for: it needs an interpreter, `libstdc++` and `libgcc`. Use " +
        `\`${DockerImageBuilder.DEFAULT_COMPILE_BASE}\` (the default), or an ` +
        "alpine base with `libstdc++` installed.",
    );
  }

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
    return manifest.runtimes[0].runtime;
  }
}
