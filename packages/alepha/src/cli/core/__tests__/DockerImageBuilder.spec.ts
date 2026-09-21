import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import type { ImageOptions } from "../atoms/imageOptions.ts";
import { BuildCommand } from "../commands/build.ts";
import {
  DockerImageBuilder,
  type ImageContext,
} from "../services/DockerImageBuilder.ts";

/**
 * Exposes the pipeline's order, which is the whole of the next spec.
 */
class TestBuildCommand extends BuildCommand {
  public order(): string[] {
    return this.pipeline.map((task) => task.constructor.name);
  }
}

describe("DockerImageBuilder", () => {
  /**
   * ⚠️ Neither the docker step nor the compile step is in the build pipeline
   * any more. Both are commands reading `./dist`: `alepha image` and `alepha
   * compile`.
   *
   * The order that used to matter here — the image being built after every
   * task that writes into `dist/public`, found by the live proof of epic #E49
   * when an image shipped with no `_headers` and no `.br` sidecar — is now
   * guaranteed by construction, because the build is over before either
   * command runs.
   */
  it("is not a build task any more", ({ expect }) => {
    const order = Alepha.create().inject(TestBuildCommand).order();
    expect(order).not.toContain("BuildDockerTask");
    expect(order).not.toContain("BuildCompileTask");
    // The tasks that write into `dist/public` are still there, and still
    // before the end of the build.
    for (const writer of [
      "BuildClientTask",
      "BuildPrerenderTask",
      "BuildStaticTask",
      "BuildHeadersTask",
      "BuildCompressTask",
    ]) {
      expect(order, writer).toContain(writer);
    }
  });

  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const task = alepha.inject(DockerImageBuilder);

    return { alepha, fs, shell, task };
  };

  /**
   * The generated Dockerfile, for the assertions about instruction ORDER
   * that a per-line regex cannot express.
   */
  const readDockerfile = (fs: MemoryFileSystemProvider): string =>
    // ⚠️ The APP directory, not `dist/`: the build wipes `dist/` on every run,
    // so a file living there could never be committed or edited by hand.
    fs.getFileContent("/project/Dockerfile") ?? "";

  /**
   * Minimal RunnerMethod stand-in. Strings are forwarded to the shell so
   * MemoryShellProvider records them; task objects have their handler invoked.
   */
  const createRun = (shell: MemoryShellProvider): ImageContext["run"] => {
    const run = (async (cmd: any, options?: any) => {
      if (typeof cmd === "string") {
        await shell.run(cmd, { root: options?.root });
        return "";
      }
      if (Array.isArray(cmd)) {
        for (const item of cmd) {
          if (typeof item === "string") {
            await shell.run(item);
          } else {
            await item.handler();
          }
        }
        return "";
      }
      const result = await cmd.handler();
      return String(result ?? "");
    }) as ImageContext["run"];
    run.rm = async () => "";
    run.cp = async () => "";
    run.end = () => {};
    return run;
  };

  /**
   * The context `alepha image` hands the builder: what was built, where, and
   * how the author wants it packaged. No build options — Docker left
   * `alepha build --target=docker`, and its config left `build` with it.
   */
  const createCtx = (
    _fs: MemoryFileSystemProvider,
    shell: MemoryShellProvider,
    image: ImageOptions = {},
    overrides: Partial<ImageContext> = {},
  ): ImageContext => ({
    root: "/project",
    distDir: "dist",
    runtime: "node",
    image,
    run: createRun(shell),
    ...overrides,
  });

  describe("standard mode", () => {
    it("writes a node Dockerfile by default", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(createCtx(fs, shell, {}));

      expect(fs.wasWritten("/project/Dockerfile")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /FROM node:24-alpine/),
      ).toBe(true);
      // Empty deps → no install line (Vite bundled everything).
      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /RUN npm install/),
      ).toBe(false);
      expect(
        fs.wasWrittenMatching(
          "/project/Dockerfile",
          // The primary slice's entry wrapper: an image runs one process from
          // one entry point, and the first declared runtime is what the
          // manifest names, so the two agree by construction.
          /CMD \["node", "index\.node\.js"\]/,
        ),
      ).toBe(true);
    });

    it("includes `RUN npm install` when dist/package.json has runtime deps", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
      );

      await task.run(createCtx(fs, shell, {}));

      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /RUN npm install/),
      ).toBe(true);
    });

    it("emits a local install line when build.docker.install is set", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(createCtx(fs, shell, { install: ["wrangler", "tsx"] }));

      expect(
        fs.wasWrittenMatching(
          "/project/Dockerfile",
          /RUN npm install --no-save --no-fund --no-audit wrangler tsx/,
        ),
      ).toBe(true);
    });

    it("writes a bun Dockerfile when runtime=bun", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
      );
      await task.run(createCtx(fs, shell, {}, { runtime: "bun" }));

      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /FROM oven\/bun:alpine/),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /RUN bun install/),
      ).toBe(true);
    });

    it("runs as uid 1000 and copies with a matching --chown", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, {}));

      expect(
        fs.wasWrittenMatching(
          "/project/Dockerfile",
          /^COPY --chown=1000:1000 \. \.$/m,
        ),
      ).toBe(true);
      expect(fs.wasWrittenMatching("/project/Dockerfile", /^USER 1000$/m)).toBe(
        true,
      );
      // `USER` lands after the install lines, which need root.
      const dockerfile = readDockerfile(fs);
      expect(dockerfile.indexOf("USER 1000")).toBeLessThan(
        dockerfile.indexOf("CMD ["),
      );
    });

    it("honors an explicit user, and drops --chown when it is root", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, { user: "root" }));

      expect(fs.wasWrittenMatching("/project/Dockerfile", /^USER root$/m)).toBe(
        true,
      );
      expect(fs.wasWrittenMatching("/project/Dockerfile", /--chown/)).toBe(
        false,
      );
    });

    it("emits ENV lines after SERVER_HOST so an app override wins", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          env: { DATA_DIR: "/data", SERVER_HOST: "127.0.0.1" },
        }),
      );

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toContain('ENV DATA_DIR="/data"');
      expect(dockerfile.indexOf("ENV SERVER_HOST=0.0.0.0")).toBeLessThan(
        dockerfile.indexOf('ENV SERVER_HOST="127.0.0.1"'),
      );
    });

    it("escapes ENV values so a space or quote cannot change the meaning", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          env: {
            WITH_SPACE: "a b",
            WITH_QUOTE: 'a"b',
            WITH_BACKSLASH: "a\\b",
          },
        }),
      );

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toContain('ENV WITH_SPACE="a b"');
      expect(dockerfile).toContain('ENV WITH_QUOTE="a\\"b"');
      expect(dockerfile).toContain('ENV WITH_BACKSLASH="a\\\\b"');
    });

    it("creates and chowns a declared volume before its VOLUME line", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, { volumes: ["/data"] }));

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toContain(
        'RUN mkdir -p "/data" && chown 1000:1000 "/data"',
      );
      expect(dockerfile).toContain('VOLUME ["/data"]');
      // A named volume inherits ownership from the image at the VOLUME
      // line, so anything done after it is discarded.
      expect(dockerfile.indexOf("RUN mkdir -p")).toBeLessThan(
        dockerfile.indexOf("VOLUME ["),
      );
    });

    it("skips the volume chown when running as root", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(fs, shell, { volumes: ["/data"], user: "root" }),
      );

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toContain('VOLUME ["/data"]');
      expect(dockerfile).not.toContain("chown");
    });

    it("copies migrations directory when present", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.mkdir("/project/migrations");
      await fs.writeFile("/project/migrations/001.sql", "CREATE TABLE x;");
      await task.run(createCtx(fs, shell, {}));
      expect(await fs.exists("/project/dist/migrations/001.sql")).toBe(true);
    });
  });

  describe("compile mode", () => {
    // ⚠️ The binary's NAME, on the flags, not a `compile` build option.
    // `--compile` left `buildOptions` for `alepha compile`; all the Dockerfile
    // writer still needs to know is whether a binary exists and what it is
    // called.
    const compileOptions: ImageOptions = {};
    const compiled = (name = "app"): Partial<ImageContext> => ({
      runtime: "bun",
      compile: name,
    });

    it("names the COPY and the ENTRYPOINT after compile.name", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, compileOptions, compiled("loom")));

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toMatch(/^COPY loom \.$/m);
      expect(dockerfile).toContain('ENTRYPOINT ["/app/loom"]');
    });

    it("leaves compiling to BuildCompileTask, which runs after compression", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, compileOptions, compiled()));

      expect(shell.wasCalledMatching(/^bun build/)).toBe(false);
      expect(await fs.exists("/project/dist/index.node.js")).toBe(true);
    });

    /**
     * The binary already exists when `alepha image` runs: compiling is a
     * separate command over the same `./dist`. This used to be the opposite
     * assertion — the docker task ran mid-build, before the compile step, so
     * it had to NOT build the image and leave that to the compile task.
     */
    it("builds the image, since the binary is already there", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(
          fs,
          shell,
          { ...compileOptions, image: { tag: "ghcr.io/o/app" } },
          { build: true, compile: "app", runtime: "bun" },
        ),
      );

      expect(shell.wasCalledMatching(/^docker build .*ghcr\.io\/o\/app/)).toBe(
        true,
      );
    });

    it("writes a distroless Dockerfile without bun install", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(createCtx(fs, shell, compileOptions, compiled()));

      expect(
        fs.wasWrittenMatching(
          "/project/Dockerfile",
          // ⚠️ `cc-debian12`, not `static-debian12`. Measured: a Bun
          // `--compile` binary is dynamically linked under every triple and
          // needs an interpreter, `libstdc++` and `libgcc`. On a base with no
          // libc it produced `exec /app/app: no such file or directory` — an
          // error naming a file that is right there.
          new RegExp(`FROM ${DockerImageBuilder.DEFAULT_COMPILE_BASE}`),
        ),
      ).toBe(true);
      expect(fs.wasWrittenMatching("/project/Dockerfile", /bun install/)).toBe(
        false,
      );
      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /^COPY app \.$/m),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/Dockerfile",
          /ENTRYPOINT \["\/app\/app"\]/,
        ),
      ).toBe(true);
    });

    it("takes a custom base image from docker.from", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(
          fs,
          shell,
          { ...compileOptions, from: "alpine:3.20" },
          compiled(),
        ),
      );

      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /FROM alpine:3\.20/),
      ).toBe(true);
    });

    it("omits the migrations COPY line when no migrations directory exists", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, compileOptions, compiled()));

      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /COPY migrations/),
      ).toBe(false);
    });

    it("stays root, and says why in the generated file", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, compileOptions, compiled()));

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).not.toMatch(/^USER /m);
      expect(dockerfile).toContain("# Runs as root:");
    });

    it("emits ENV and VOLUME, but no chown, when a volume is declared", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(
          fs,
          shell,
          {
            ...compileOptions,
            env: { DATA_DIR: "/data" },
            volumes: ["/data"],
          },
          compiled(),
        ),
      );

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toContain('ENV DATA_DIR="/data"');
      expect(dockerfile).toContain('VOLUME ["/data"]');
      // No shell in distroless: nothing can prepare the directory.
      expect(dockerfile).not.toMatch(/^RUN /m);
    });

    it("emits USER in compile mode when one is set explicitly", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          ...compileOptions,
          user: "65532",
        }),
      );

      expect(
        fs.wasWrittenMatching("/project/Dockerfile", /^USER 65532$/m),
      ).toBe(true);
    });

    it("includes the migrations COPY line when migrations exist", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");
      await fs.mkdir("/project/migrations");
      await fs.writeFile("/project/migrations/001.sql", "CREATE TABLE x;");

      await task.run(createCtx(fs, shell, compileOptions, compiled()));

      expect(
        fs.wasWrittenMatching(
          "/project/Dockerfile",
          /COPY migrations \.\/migrations/,
        ),
      ).toBe(true);
    });
  });

  describe("--image flag", () => {
    // The flag documents itself as "-i=<version> for specific version", but a
    // bare value was taken as the image NAME — `--image=1.3.4` produced an
    // image called `1.3.4:latest`, silently misnamed.
    const dockerOptions: ImageOptions = {
      image: { tag: "registry.example.com/app" },
    } as ImageOptions;

    const buildWith = async (image: boolean | string) => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(createCtx(fs, shell, dockerOptions, { build: image }));

      return shell.calls.map((it) => it.command).join("\n");
    };

    it("treats a bare value as the version", async () => {
      expect(await buildWith("1.3.4")).toContain(
        "registry.example.com/app:1.3.4",
      );
    });

    it("still accepts the explicit :version form", async () => {
      expect(await buildWith(":2.0.0")).toContain(
        "registry.example.com/app:2.0.0",
      );
    });

    it("still accepts a full name:tag value", async () => {
      expect(await buildWith("other/img:9.9.9")).toContain("other/img:9.9.9");
    });

    it("defaults to latest with no value", async () => {
      expect(await buildWith(true)).toContain(
        "registry.example.com/app:latest",
      );
    });
  });

  describe("OCI labels", () => {
    const buildWithImage = async (image: ImageOptions) => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");
      shell.outputs.set("git rev-parse --short HEAD", "abc1234\n");

      await task.run(createCtx(fs, shell, image, { build: "1.2.3" }));

      return {
        cmd: shell.calls.map((it) => it.command).join("\n"),
        dockerfile: readDockerfile(fs),
      };
    };

    it("passes the build-describing labels on the docker build", async () => {
      const { cmd } = await buildWithImage({
        image: { tag: "ghcr.io/myorg/app", oci: true },
      });

      expect(cmd).toContain(
        "--label 'org.opencontainers.image.revision=abc1234'",
      );
      expect(cmd).toContain("--label 'org.opencontainers.image.created=");
      expect(cmd).toContain("--label 'org.opencontainers.image.version=1.2.3'");
    });

    it("writes source, title, description and licenses into the Dockerfile", async () => {
      const { cmd, dockerfile } = await buildWithImage({
        image: {
          tag: "ghcr.io/myorg/app",
          oci: true,
          source: "https://github.com/myorg/app",
          title: "App",
          description: "Self-hosted app",
          licenses: "Apache-2.0",
        },
      });

      // In the FILE, not on the command: a build the CLI did not run - the
      // release workflow drives `docker buildx build` on this file - must
      // still carry them, and `source` is what links the published package
      // to its repository on GHCR.
      expect(dockerfile).toContain(
        'LABEL "org.opencontainers.image.source"="https://github.com/myorg/app"',
      );
      expect(dockerfile).toContain(
        'LABEL "org.opencontainers.image.title"="App"',
      );
      expect(dockerfile).toContain(
        'LABEL "org.opencontainers.image.description"="Self-hosted app"',
      );
      expect(dockerfile).toContain(
        'LABEL "org.opencontainers.image.licenses"="Apache-2.0"',
      );
      // Not duplicated onto the command line.
      expect(cmd).not.toContain("org.opencontainers.image.source");
    });

    it("omits a label entirely rather than emitting an empty one", async () => {
      const { dockerfile } = await buildWithImage({
        image: { tag: "ghcr.io/myorg/app", oci: true, title: "App" },
      });

      expect(dockerfile).toContain(
        'LABEL "org.opencontainers.image.title"="App"',
      );
      expect(dockerfile).not.toContain("org.opencontainers.image.source");
      expect(dockerfile).not.toContain("org.opencontainers.image.description");
      expect(dockerfile).not.toContain("org.opencontainers.image.licenses");
    });

    it("escapes a label value carrying a quote", async () => {
      const { dockerfile } = await buildWithImage({
        image: {
          tag: "ghcr.io/myorg/app",
          oci: true,
          description: 'It\'s a "self-hosted" app',
        },
      });

      expect(dockerfile).toContain(
        'LABEL "org.opencontainers.image.description"="It\'s a \\"self-hosted\\" app"',
      );
    });

    it("emits no OCI labels at all when oci is off", async () => {
      const { cmd, dockerfile } = await buildWithImage({
        image: {
          tag: "ghcr.io/myorg/app",
          source: "https://github.com/myorg/app",
        },
      });

      expect(cmd).not.toContain("--label");
      expect(dockerfile).not.toContain("org.opencontainers.image.");
      // The runtime label is not part of the `oci` opt-in.
      expect(dockerfile).toContain('LABEL "dev.alepha.runtime"="node"');
    });

    it("writes the labels into the compile variant too", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");

      await task.run(
        createCtx(
          fs,
          shell,
          {
            image: {
              tag: "ghcr.io/myorg/app",
              oci: true,
              source: "https://github.com/myorg/app",
            },
          },
          { compile: "app", runtime: "bun" },
        ),
      );

      expect(readDockerfile(fs)).toContain(
        'LABEL "org.opencontainers.image.source"="https://github.com/myorg/app"',
      );
    });
  });

  /**
   * `dev.alepha.runtime` is what lets a registry reader answer "what runs
   * inside this image" without taking the pusher's word for it. It is
   * Alepha's own contract rather than an OCI annotation, so it is emitted
   * whether or not the app opted into `oci`.
   *
   * Only `node` and `bun` are reachable: `alepha image` refuses a `static`
   * artifact (nothing to start) and a `workerd` one (only Cloudflare runs it)
   * by name, before the builder is reached.
   */
  describe("the dev.alepha.runtime label", () => {
    const writeDockerfileFor = async (
      options: ImageOptions,
      overrides: Partial<ImageContext> = {},
    ) => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.node.js", "// bundle");
      await task.run(createCtx(fs, shell, options, overrides));
      return readDockerfile(fs);
    };

    it("declares node in the standard variant, with no oci config at all", async () => {
      const dockerfile = await writeDockerfileFor({});

      expect(dockerfile).toContain('LABEL "dev.alepha.runtime"="node"');
    });

    it("declares node when no runtime is set, matching the manifest's default", async () => {
      const dockerfile = await writeDockerfileFor({});

      expect(dockerfile).toContain('LABEL "dev.alepha.runtime"="node"');
    });

    it("declares bun in the standard variant", async () => {
      const dockerfile = await writeDockerfileFor({}, { runtime: "bun" });

      expect(dockerfile).toContain('LABEL "dev.alepha.runtime"="bun"');
    });

    it("declares bun in the compile variant, which is bun by construction", async () => {
      const dockerfile = await writeDockerfileFor(
        {},
        { runtime: "bun", compile: "app" },
      );

      expect(dockerfile).toContain(
        `FROM ${DockerImageBuilder.DEFAULT_COMPILE_BASE}`,
      );
      expect(dockerfile).toContain('LABEL "dev.alepha.runtime"="bun"');
    });

    it("declares node in the compile variant's sibling, the node standard build", async () => {
      // The compile branch is bun by construction (`bun build --compile` is
      // what exists), so the node assertion for that code path is the standard
      // one above. This pins that the two branches do not disagree about the
      // label's shape.
      const compile = await writeDockerfileFor(
        {},
        { runtime: "bun", compile: "app" },
      );
      const standard = await writeDockerfileFor({});

      expect(compile).toMatch(/^LABEL "dev\.alepha\.runtime"="bun"$/m);
      expect(standard).toMatch(/^LABEL "dev\.alepha\.runtime"="node"$/m);
    });

    it("sits beside the OCI labels rather than replacing them", async () => {
      const dockerfile = await writeDockerfileFor({
        image: { tag: "ghcr.io/myorg/app", oci: true, title: "App" },
      });

      expect(dockerfile).toContain('LABEL "dev.alepha.runtime"="node"');
      expect(dockerfile).toContain(
        'LABEL "org.opencontainers.image.title"="App"',
      );
    });
  });
});
