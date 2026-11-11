import { $inject, $store, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/system";

import { buildOptions } from "../atoms/buildOptions.ts";
import type { BuildRuntime } from "../atoms/buildOptions.ts";
import { imageOptions } from "../atoms/imageOptions.ts";
import type { BuildManifest } from "../schemas/buildManifest.ts";
import { BuildManifestReader } from "../services/BuildManifestReader.ts";
import { DockerImageBuilder } from "../services/DockerImageBuilder.ts";
import { StaticImageBundler } from "../services/StaticImageBundler.ts";
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
  protected readonly manifestReader = $inject(BuildManifestReader);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly builder = $inject(DockerImageBuilder);
  protected readonly compiler = $inject(WorkspaceCompiler);
  protected readonly staticBundler = $inject(StaticImageBundler);
  protected readonly options = $store(imageOptions);
  protected readonly build = $store(buildOptions);

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
      platform: z
        .text()
        .describe(
          "Platforms to build for, comma-separated: `linux/amd64` or `linux/amd64,linux/arm64`. Same as `image.platforms`.",
        )
        .optional(),
      sbom: z
        .boolean()
        .describe(
          "Attach an SBOM attestation and copy dist/sbom.cdx.json into the image. Needs `build.sbom`. Same as `image.sbom`.",
        )
        .optional(),
      provenance: z
        .boolean()
        .describe(
          "Attach a `mode=max` provenance attestation, which records the build arguments. Same as `image.provenance`.",
        )
        .optional(),
      push: z
        .boolean()
        .describe(
          "Build and push in one step (`docker buildx build --push`). The tag must name the registry.",
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

      // A static site runs Alepha's own static server, bundled into dist/:
      // the artifact itself holds no server code.
      if (runtime === "static" && flags.compile) {
        throw new AlephaError(
          "`--compile` needs a bun slice, and a static artifact has none: its image runs Alepha's static server on node or bun. Drop `--compile`.",
        );
      }
      if (runtime === "workerd") {
        throw new AlephaError(
          "This artifact's primary slice is `workerd`, which only Cloudflare runs. Build a node or bun slice first (`alepha build --runtime node`), or declare it first in `build.runtime` so it becomes the primary.",
        );
      }

      const distDir = this.build.output?.dist ?? "dist";
      const sbom = flags.sbom ?? this.options.sbom ?? false;
      const provenance = flags.provenance ?? this.options.provenance ?? false;
      const push = flags.push ?? false;
      if (push && flags.dockerfile) {
        throw new AlephaError(
          "`--push` builds and pushes an image, and `--dockerfile` builds none: pass one of them.",
        );
      }
      const platforms = this.resolvePlatforms(flags.platform, !!flags.compile);
      // Before the compile, which can take minutes.
      if (!flags.dockerfile) {
        await this.builder.preflight({
          root,
          distDir,
          sbom,
          provenance,
          push,
          platforms,
        });
      }

      const compiled = flags.compile
        ? await this.compileFirst(root, flags.compile, run, platforms)
        : undefined;

      if (runtime === "static") {
        await run({
          name: `bundle the static server → ${distDir}/${StaticImageBundler.ENTRY}`,
          handler: () => this.staticBundler.bundle(root, distDir),
        });
      }

      await this.builder.run({
        root,
        distDir,
        sbom,
        provenance,
        push,
        platforms,
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
    platforms: string[] = [],
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
    // ⚠️ The ARCHITECTURE comes from the platform when one is asked for,
    // never from the host: `--platform linux/amd64` on an arm64 laptop used
    // to ship an amd64 image holding an arm64 binary, which dies with
    // `exec format error`. The libc half still comes from the base.
    const binaries =
      platforms.length > 1
        ? platforms.map((platform) => ({
            name: `${name}-${this.dockerArch(platform)}`,
            target: this.bunTargetFor(platform, musl),
          }))
        : [
            {
              name,
              target: platforms.length
                ? this.bunTargetFor(platforms[0], musl)
                : this.compiler.defaultBunTarget({ linux: true, musl }),
            },
          ];
    const target = binaries.map((it) => it.target).join(", ");

    await run({
      name: `compile → ${binaries.map((it) => it.name).join(", ")} (${target})`,
      handler: async () => {
        await this.compiler.compile({
          root,
          name,
          binaries,
          // The image's own `COPY migrations` line handles them, and the
          // builder copies them into the context itself.
          migrations: false,
          output: this.build.output,
        });
      },
    });
    return name;
  }

  /**
   * The platforms to build for: `--platform`, else `image.platforms`, else
   * none (the builder's own default, as today).
   *
   * @throws {AlephaError} on `--platform` inside `image.args`, which would be
   * a second source disagreeing silently, and on a platform a compiled
   * binary cannot target
   */
  protected resolvePlatforms(
    flag: string | undefined,
    compile: boolean,
  ): string[] {
    const args = this.options.args ?? [];
    if (
      args.some((it) => it === "--platform" || it.startsWith("--platform="))
    ) {
      throw new AlephaError(
        "`image.args` carries `--platform`: use `image.platforms` (or `--platform` on the command) instead. " +
          "The architecture of a compiled binary is taken from that list, and a `--platform` passed through " +
          "`args` was never seen by the compile: it built the host's architecture into an image of another.",
      );
    }
    const platforms = (flag ? flag.split(",") : (this.options.platforms ?? []))
      .map((it) => it.trim())
      .filter(Boolean);
    for (const platform of platforms) {
      if (!/^[a-z0-9]+\/[a-z0-9]+(\/[a-z0-9]+)?$/.test(platform)) {
        throw new AlephaError(
          `'${platform}' is not a platform: write it as os/arch, e.g. linux/amd64.`,
        );
      }
      if (compile && !this.compilePlatforms.includes(platform)) {
        throw new AlephaError(
          `A compiled image is built for ${this.compilePlatforms.join(" or ")}, not '${platform}': ` +
            "those are the Linux targets Bun compiles for.",
        );
      }
    }
    return [...new Set(platforms)];
  }

  /**
   * The platforms a compiled image can be built for: Bun's Linux targets.
   */
  protected readonly compilePlatforms = ["linux/amd64", "linux/arm64"];

  /**
   * `linux/amd64` → `amd64`: the `TARGETARCH` buildx sets, which names the
   * binary.
   */
  protected dockerArch(platform: string): string {
    return platform.split("/")[1];
  }

  /**
   * The Bun triple for a platform and a libc: `linux/amd64` → `bun-linux-x64`.
   */
  protected bunTargetFor(platform: string, musl: boolean): string {
    const arch = this.dockerArch(platform) === "amd64" ? "x64" : "arm64";
    return musl ? `bun-linux-${arch}-musl` : `bun-linux-${arch}`;
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
    return this.manifestReader.read(
      this.fs.join(root, this.build.output?.dist ?? "dist", "manifest.json"),
    );
  }

  /**
   * The first declared runtime, which is what the image runs.
   */
  protected primaryRuntime(manifest: BuildManifest): BuildRuntime | "static" {
    return manifest.runtimes[0].runtime;
  }
}
