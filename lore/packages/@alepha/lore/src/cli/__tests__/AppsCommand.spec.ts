import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { AppsCommand } from "../commands/AppsCommand.ts";

/**
 * `lore apps build`: which targets, and what must never reach the bytes.
 *
 * ⚠️ **The load-bearing case is "byte-identical".** `--env` exists so an app
 * whose environments want different runtimes can say "build what that env can
 * run". It must never thread an env-specific VALUE into the build - not
 * `DATABASE_URL`, not `R2_BUCKET_NAME`, not a secret - because a value frozen
 * into a stored artifact breaks promotion, which is the whole reason the
 * registry exists. Two envs on one estate type producing different bytes is
 * that failure, and it is the failure this file exists to catch.
 */
describe("lore apps build", () => {
  const create = (
    instances: Record<string, { estateId?: string }> = {},
    estates: Array<{ id: string; acceptedRuntimes: string[] }> = [],
  ) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "",
        LORE_PROJECT: "alepha",
        LORE_APP: "",
        LORE_ENV: "",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const cli = alepha.inject(CliProvider);
    const command = alepha.inject(AppsCommand);

    Object.assign(command as unknown as Record<string, unknown>, {
      apps: {
        getApp: async ({ params }: { params: { env: string } }) =>
          instances[params.env],
      },
      estates: {
        listProjectEstates: async () => ({ items: estates }),
      },
      projects: {
        resolve: async () => 1,
        resolveApp: async () => "docs",
      },
    });

    return { alepha, fs, shell, cli, command };
  };

  /**
   * A workspace the build can run in, with a `dist/` for `collect` to move.
   */
  const aWorkspace = async (fs: MemoryFileSystemProvider) => {
    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "docs" }),
    );
    await fs.writeFile("/project/dist/index.js", "console.log(1);");
    await fs.writeFile(
      "/project/dist/manifest.json",
      JSON.stringify({ version: 1, runtime: "workerd", project: "docs" }),
    );
  };

  const commandsOf = (shell: MemoryShellProvider) =>
    shell.calls.map((it) => it.command);

  it("builds what the local config declares when nothing narrows", async () => {
    // ⚠️ The offline path, and the only one that needs no network at all.
    // `alepha build` with no `-t` is what reads the config's own target.
    const { fs, shell, cli, command } = create();
    await aWorkspace(fs);

    await cli.run(command.build, { root: "/project", argv: "" });

    expect(commandsOf(shell)).toContain("npx alepha build");
  });

  it("builds each target of a comma-separated list", async () => {
    const { fs, shell, cli, command } = create();
    await aWorkspace(fs);

    await cli.run(command.build, {
      root: "/project",
      argv: "--target cloudflare,bare --tag 0.28.0",
    });

    expect(commandsOf(shell)).toContain("npx alepha build -t cloudflare");
    // ⚠️ `bare` says its runtime out loud: the target alone leaves it at the
    // default, and a manifest naming the wrong runtime lands the push under
    // the wrong identity.
    expect(commandsOf(shell)).toContain(
      "npx alepha build -t bare --runtime node",
    );
  });

  it("writes each target to its own directory, named locally", async () => {
    // ⚠️ `<app>_<target>_<tag>` is an output DIRECTORY and never an artifact
    // identity. Epic #18 rejected `my-app_1.2.3_cloudflare.tar.gz` explicitly:
    // it makes two builds of one release look like two releases. The identity
    // is `(projectId, app, tag, runtime)`, and the server reads `runtime` out
    // of the artifact's own manifest at push time, never from a filename.
    const { fs, cli, command } = create();
    await aWorkspace(fs);

    await cli.run(command.build, {
      root: "/project",
      argv: "--target cloudflare --tag 0.28.0",
    });

    expect(await fs.exists("/project/dist/docs_cloudflare_0.28.0")).toBe(true);
  });

  describe("--env", () => {
    const twoCloudflareEnvs = () =>
      create(
        {
          staging: { estateId: "e1" },
          production: { estateId: "e2" },
        },
        [
          { id: "e1", acceptedRuntimes: ["workerd"] },
          { id: "e2", acceptedRuntimes: ["workerd"] },
        ],
      );

    it("selects a target and nothing else", async () => {
      const { fs, shell, cli, command } = create(
        { yyy: { estateId: "bay-1" } },
        [{ id: "bay-1", acceptedRuntimes: ["node"] }],
      );
      await aWorkspace(fs);

      await cli.run(command.build, { root: "/project", argv: "--env yyy" });

      expect(commandsOf(shell)).toContain(
        "npx alepha build -t bare --runtime node",
      );
    });

    /**
     * ⚠️ **The test that separates the flag from the thing it must not be.**
     * If `--env staging` and `--env production`, both Cloudflare, give
     * different bytes, `--env` has started threading an env-specific value
     * into the build and promotion across environments is broken.
     */
    it("gives byte-identical output for two envs on one estate type", async () => {
      const staging = twoCloudflareEnvs();
      await aWorkspace(staging.fs);
      await staging.cli.run(staging.command.build, {
        root: "/project",
        argv: "--env staging --tag 0.28.0",
      });

      const production = twoCloudflareEnvs();
      await aWorkspace(production.fs);
      await production.cli.run(production.command.build, {
        root: "/project",
        argv: "--env production --tag 0.28.0",
      });

      // The build command line is the whole of what an env can influence, and
      // it carries a target and nothing else.
      const build = (shell: MemoryShellProvider) =>
        commandsOf(shell).filter((it) => it.startsWith("npx alepha build"));
      expect(build(staging.shell)).toEqual(build(production.shell));
      expect(build(staging.shell)).toEqual(["npx alepha build -t cloudflare"]);
    });

    it("refuses an --env that contradicts --target", async () => {
      // A conflict, not a precedence question: silently picking one produces
      // bytes the operator did not ask for and a deploy that fails much later.
      const { fs, cli, command } = create({ xxx: { estateId: "cf-1" } }, [
        { id: "cf-1", acceptedRuntimes: ["workerd"] },
      ]);
      await aWorkspace(fs);

      await expect(
        cli.run(command.build, {
          root: "/project",
          argv: "--env xxx --target docker",
        }),
      ).rejects.toThrowError(
        /--env xxx needs `--target cloudflare`, but --target says `docker`/,
      );
    });

    it("refuses an env whose copy has no estate", async () => {
      // Refused, not fallen back on: building every target for an environment
      // that names no estate produces bytes nobody asked for and hides the
      // real problem.
      const { fs, cli, command } = create({ zzz: {} }, []);
      await aWorkspace(fs);

      await expect(
        cli.run(command.build, { root: "/project", argv: "--env zzz" }),
      ).rejects.toThrowError(/has no estate/);
    });
  });
});
