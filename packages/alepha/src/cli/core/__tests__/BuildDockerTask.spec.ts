import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import type { BuildOptions } from "../atoms/buildOptions.ts";
import type { AppEntry } from "../providers/AppEntryProvider.ts";
import { BuildDockerTask } from "../tasks/BuildDockerTask.ts";
import type { BuildTaskContext } from "../tasks/BuildTask.ts";

describe("BuildDockerTask", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const task = alepha.inject(BuildDockerTask);

    return { alepha, fs, shell, task };
  };

  /**
   * The generated Dockerfile, for the assertions about instruction ORDER
   * that a per-line regex cannot express.
   */
  const readDockerfile = (fs: MemoryFileSystemProvider): string =>
    fs.getFileContent("/project/dist/Dockerfile") ?? "";

  /**
   * Minimal RunnerMethod stand-in. Strings are forwarded to the shell so
   * MemoryShellProvider records them; task objects have their handler invoked.
   */
  const createRun = (shell: MemoryShellProvider): BuildTaskContext["run"] => {
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
    }) as BuildTaskContext["run"];
    run.rm = async () => "";
    run.cp = async () => "";
    run.end = () => {};
    return run;
  };

  const createCtx = (
    _fs: MemoryFileSystemProvider,
    shell: MemoryShellProvider,
    options: BuildOptions,
    overrides: Partial<BuildTaskContext> = {},
  ): BuildTaskContext => ({
    alepha: {} as any,
    options,
    run: createRun(shell),
    root: "/project",
    entry: { server: "/project/src/server.ts" } as AppEntry,
    hasClient: false,
    manifest: null,
    platformOptions: null,
    flags: {},
    ...overrides,
  });

  describe("standard mode", () => {
    it("writes a node Dockerfile by default", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(
        createCtx(fs, shell, { target: "docker", runtime: "node" }),
      );

      expect(fs.wasWritten("/project/dist/Dockerfile")).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
          /FROM node:24-alpine/,
        ),
      ).toBe(true);
      // Empty deps → no install line (Vite bundled everything).
      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /RUN npm install/),
      ).toBe(false);
      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
          /CMD \["node", "index\.js"\]/,
        ),
      ).toBe(true);
    });

    it("includes `RUN npm install` when dist/package.json has runtime deps", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
      );

      await task.run(
        createCtx(fs, shell, { target: "docker", runtime: "node" }),
      );

      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /RUN npm install/),
      ).toBe(true);
    });

    it("emits a local install line when build.docker.install is set", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(
        createCtx(fs, shell, {
          target: "docker",
          runtime: "node",
          docker: { install: ["wrangler", "tsx"] },
        }),
      );

      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
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
      await task.run(
        createCtx(fs, shell, { target: "docker", runtime: "bun" }),
      );

      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
          /FROM oven\/bun:alpine/,
        ),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /RUN bun install/),
      ).toBe(true);
    });

    it("does nothing when target is not docker", async () => {
      const { fs, shell, task } = createTestEnv();
      await task.run(createCtx(fs, shell, { target: "bare", runtime: "node" }));
      expect(fs.wasWritten("/project/dist/Dockerfile")).toBe(false);
    });

    it("runs as uid 1000 and copies with a matching --chown", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, { target: "docker", runtime: "node" }),
      );

      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
          /^COPY --chown=1000:1000 \. \.$/m,
        ),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /^USER 1000$/m),
      ).toBe(true);
      // `USER` lands after the install lines, which need root.
      const dockerfile = readDockerfile(fs);
      expect(dockerfile.indexOf("USER 1000")).toBeLessThan(
        dockerfile.indexOf("CMD ["),
      );
    });

    it("honors an explicit user, and drops --chown when it is root", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          target: "docker",
          runtime: "node",
          docker: { user: "root" },
        }),
      );

      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /^USER root$/m),
      ).toBe(true);
      expect(fs.wasWrittenMatching("/project/dist/Dockerfile", /--chown/)).toBe(
        false,
      );
    });

    it("emits ENV lines after SERVER_HOST so an app override wins", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          target: "docker",
          runtime: "node",
          docker: {
            env: { DATA_DIR: "/data", SERVER_HOST: "127.0.0.1" },
          },
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
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          target: "docker",
          runtime: "node",
          docker: {
            env: {
              WITH_SPACE: "a b",
              WITH_QUOTE: 'a"b',
              WITH_BACKSLASH: "a\\b",
            },
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
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          target: "docker",
          runtime: "node",
          docker: { volumes: ["/data"] },
        }),
      );

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
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          target: "docker",
          runtime: "node",
          docker: { volumes: ["/data"], user: "root" },
        }),
      );

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toContain('VOLUME ["/data"]');
      expect(dockerfile).not.toContain("chown");
    });

    it("copies migrations directory when present", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.mkdir("/project/migrations");
      await fs.writeFile("/project/migrations/001.sql", "CREATE TABLE x;");
      await task.run(
        createCtx(fs, shell, { target: "docker", runtime: "node" }),
      );
      expect(await fs.exists("/project/dist/migrations/001.sql")).toBe(true);
    });
  });

  describe("compile mode", () => {
    const compileOptions: BuildOptions = {
      target: "docker",
      runtime: "bun",
      docker: { compile: true },
    };

    it("invokes bun build --compile with the host-arch musl target", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(createCtx(fs, shell, compileOptions));

      expect(
        shell.wasCalledMatching(
          /bun build --compile --target=bun-linux-(x64|arm64)-musl --minify --outfile=app index\.js/,
        ),
      ).toBe(true);
    });

    it("runs the compile command from the dist directory", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(createCtx(fs, shell, compileOptions));

      const calls = shell.getCallsMatching(/^bun build/);
      expect(calls).toHaveLength(1);
      expect(calls[0].options.root).toBe("/project/dist");
    });

    it("writes a distroless Dockerfile without bun install", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(createCtx(fs, shell, compileOptions));

      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
          /FROM gcr\.io\/distroless\/static-debian12/,
        ),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /bun install/),
      ).toBe(false);
      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /^COPY app \.$/m),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
          /ENTRYPOINT \["\/app\/app"\]/,
        ),
      ).toBe(true);
    });

    it("honors a custom target, base image, and minify=false", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          target: "docker",
          runtime: "bun",
          docker: {
            compile: {
              target: "bun-linux-x64-modern-musl",
              base: "alpine:3.20",
              minify: false,
            },
          },
        }),
      );

      expect(
        shell.wasCalledMatching(
          /bun build --compile --target=bun-linux-x64-modern-musl --outfile=app index\.js/,
        ),
      ).toBe(true);
      expect(shell.wasCalledMatching(/--minify/)).toBe(false);
      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /FROM alpine:3\.20/),
      ).toBe(true);
    });

    it("removes pre-compile artifacts after building the binary", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile("/project/dist/server/abc123.js", "// chunk");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: {} }),
      );

      await task.run(createCtx(fs, shell, compileOptions));

      expect(await fs.exists("/project/dist/index.js")).toBe(false);
      expect(await fs.exists("/project/dist/server")).toBe(false);
      expect(await fs.exists("/project/dist/package.json")).toBe(false);
    });

    it("rejects when externals are present", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.writeFile(
        "/project/dist/package.json",
        JSON.stringify({ dependencies: { sharp: "^0.33.0" } }),
      );

      await expect(
        task.run(createCtx(fs, shell, compileOptions)),
      ).rejects.toThrow(/not bundled by Vite.*sharp/);
    });

    it("rejects when runtime is not bun", async () => {
      const { fs, shell, task } = createTestEnv();
      await expect(
        task.run(
          createCtx(fs, shell, {
            target: "docker",
            runtime: "node",
            docker: { compile: true },
          }),
        ),
      ).rejects.toThrow(/Compile mode requires runtime 'bun'/);
    });

    it("omits the migrations COPY line when no migrations directory exists", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(createCtx(fs, shell, compileOptions));

      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /COPY migrations/),
      ).toBe(false);
    });

    it("stays root, and says why in the generated file", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(createCtx(fs, shell, compileOptions));

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).not.toMatch(/^USER /m);
      expect(dockerfile).toContain("# Runs as root:");
    });

    it("emits ENV and VOLUME, but no chown, when a volume is declared", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          ...compileOptions,
          docker: {
            compile: true,
            env: { DATA_DIR: "/data" },
            volumes: ["/data"],
          },
        }),
      );

      const dockerfile = readDockerfile(fs);
      expect(dockerfile).toContain('ENV DATA_DIR="/data"');
      expect(dockerfile).toContain('VOLUME ["/data"]');
      // No shell in distroless: nothing can prepare the directory.
      expect(dockerfile).not.toMatch(/^RUN /m);
    });

    it("emits USER in compile mode when one is set explicitly", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, {
          ...compileOptions,
          docker: { compile: true, user: "65532" },
        }),
      );

      expect(
        fs.wasWrittenMatching("/project/dist/Dockerfile", /^USER 65532$/m),
      ).toBe(true);
    });

    it("includes the migrations COPY line when migrations exist", async () => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      await fs.mkdir("/project/migrations");
      await fs.writeFile("/project/migrations/001.sql", "CREATE TABLE x;");

      await task.run(createCtx(fs, shell, compileOptions));

      expect(
        fs.wasWrittenMatching(
          "/project/dist/Dockerfile",
          /COPY migrations \.\/migrations/,
        ),
      ).toBe(true);
    });
  });

  describe("--image flag", () => {
    // The flag documents itself as "-i=<version> for specific version", but a
    // bare value was taken as the image NAME — `--image=1.3.4` produced an
    // image called `1.3.4:latest`, silently misnamed.
    const dockerOptions: BuildOptions = {
      target: "docker",
      runtime: "node",
      docker: { image: { tag: "registry.example.com/app" } },
    } as BuildOptions;

    const buildWith = async (image: unknown) => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");

      await task.run(
        createCtx(fs, shell, dockerOptions, { flags: { image } as any }),
      );

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
    const buildWithImage = async (image: BuildOptions["docker"]) => {
      const { fs, shell, task } = createTestEnv();
      await fs.writeFile("/project/dist/index.js", "// bundle");
      shell.outputs.set("git rev-parse --short HEAD", "abc1234\n");

      await task.run(
        createCtx(
          fs,
          shell,
          { target: "docker", runtime: "node", docker: image },
          { flags: { image: "1.2.3" } as any },
        ),
      );

      return shell.calls.map((it) => it.command).join("\n");
    };

    it("emits the three derived labels when oci is on", async () => {
      const cmd = await buildWithImage({
        image: { tag: "ghcr.io/myorg/app", oci: true },
      });

      expect(cmd).toContain(
        "--label 'org.opencontainers.image.revision=abc1234'",
      );
      expect(cmd).toContain("--label 'org.opencontainers.image.created=");
      expect(cmd).toContain("--label 'org.opencontainers.image.version=1.2.3'");
    });

    it("emits source, title, description and licenses when configured", async () => {
      const cmd = await buildWithImage({
        image: {
          tag: "ghcr.io/myorg/app",
          oci: true,
          source: "https://github.com/myorg/app",
          title: "App",
          description: "Self-hosted app",
          licenses: "Apache-2.0",
        },
      });

      // `source` is what links the package to its repository on GHCR.
      expect(cmd).toContain(
        "--label 'org.opencontainers.image.source=https://github.com/myorg/app'",
      );
      expect(cmd).toContain("--label 'org.opencontainers.image.title=App'");
      expect(cmd).toContain(
        "--label 'org.opencontainers.image.description=Self-hosted app'",
      );
      expect(cmd).toContain(
        "--label 'org.opencontainers.image.licenses=Apache-2.0'",
      );
    });

    it("omits a label entirely rather than emitting an empty one", async () => {
      const cmd = await buildWithImage({
        image: { tag: "ghcr.io/myorg/app", oci: true, title: "App" },
      });

      expect(cmd).toContain("--label 'org.opencontainers.image.title=App'");
      expect(cmd).not.toContain("org.opencontainers.image.source");
      expect(cmd).not.toContain("org.opencontainers.image.description");
      expect(cmd).not.toContain("org.opencontainers.image.licenses");
    });

    it("escapes a label value carrying a quote", async () => {
      const cmd = await buildWithImage({
        image: {
          tag: "ghcr.io/myorg/app",
          oci: true,
          description: 'It\'s a "self-hosted" app',
        },
      });

      expect(cmd).toContain(
        `--label 'org.opencontainers.image.description=It'\\''s a "self-hosted" app'`,
      );
    });

    it("emits no labels at all when oci is off", async () => {
      const cmd = await buildWithImage({
        image: {
          tag: "ghcr.io/myorg/app",
          source: "https://github.com/myorg/app",
        },
      });

      expect(cmd).not.toContain("--label");
    });
  });
});
