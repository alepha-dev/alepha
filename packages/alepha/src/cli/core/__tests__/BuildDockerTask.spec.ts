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
});
