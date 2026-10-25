import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { ProjectCommand } from "../commands/ProjectCommand.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectLink } from "../services/LoreProjectLink.ts";

/**
 * `.alepha/lore.json` links a directory to its Lore project (#Q2698): written
 * by `lore project create` and `link`, found walking up from the working
 * directory, and read after `--project` and `LORE_PROJECT`.
 */
describe(".alepha/lore.json", () => {
  const create = async (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "",
        HOME: "/nonexistent",
        ...env,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    const link = alepha.inject(LoreProjectLink);
    const client = alepha.inject(LoreClientService);
    return { alepha, fs, link, client };
  };

  it("is found from a subdirectory, the nearest one winning", async ({
    expect,
  }) => {
    const { fs, link } = await create();
    await fs.writeJsonFile("/repo/.alepha/lore.json", { project: "hello" });
    await fs.mkdir("/repo/infra/compose", { recursive: true });
    expect(await link.find("/repo/infra/compose")).toEqual({
      project: "hello",
      path: "/repo/.alepha/lore.json",
    });
    await fs.writeJsonFile("/repo/infra/.alepha/lore.json", {
      project: "inner",
    });
    expect((await link.find("/repo/infra/compose"))?.project).toBe("inner");
    expect(await link.find("/elsewhere")).toBeUndefined();
  });

  it("comes after --project and LORE_PROJECT", async ({ expect }) => {
    const bare = await create();
    bare.link.linked = "from-file";
    expect(bare.client.resolveProject()).toBe("from-file");
    expect(bare.client.resolveProject("from-flag")).toBe("from-flag");

    const withEnv = await create({ LORE_PROJECT: "from-env" });
    withEnv.link.linked = "from-file";
    expect(withEnv.client.resolveProject()).toBe("from-env");

    const none = await create();
    expect(() => none.client.resolveProject()).toThrow("lore project link");
  });

  it("refuses to relink to another project without --force", async ({
    expect,
  }) => {
    const { fs, link } = await create();
    await link.write("/repo", "hello");
    await expect(link.write("/repo", "other")).rejects.toThrow(
      'already links this directory to "hello"',
    );
    await link.write("/repo", "other", true);
    expect(await fs.readJsonFile("/repo/.alepha/lore.json")).toEqual({
      project: "other",
    });
  });

  it("lore project create makes a project with deploys on and links the directory", async ({
    expect,
  }) => {
    const { alepha, fs } = await create();
    const created: unknown[] = [];
    Object.assign(
      alepha.inject(ProjectCommand) as unknown as Record<string, unknown>,
      {
        projectApi: {
          createProject: async (request: { body: unknown }) => {
            created.push(request.body);
            return { id: 7, slug: "hello" };
          },
        },
      },
    );
    await alepha
      .inject(CliProvider)
      .run(alepha.inject(ProjectCommand).create, { argv: "hello" });
    expect(created).toEqual([
      {
        title: "hello",
        capabilities: [{ key: "apps", options: { deploy: true } }],
      },
    ]);
    expect(await fs.readJsonFile(`${process.cwd()}/.alepha/lore.json`)).toEqual(
      { project: "hello" },
    );
  });
});
