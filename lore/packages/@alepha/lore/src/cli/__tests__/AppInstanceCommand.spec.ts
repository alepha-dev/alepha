import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { AppInstanceCommand } from "../commands/AppInstanceCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore apps instance create | update --estate <slug>` (#Q3140): the estate
 * is named by slug among those lent to the project, in the same command that
 * creates the copy, and `--estate-id` stays beside it for a script holding an
 * id.
 */
describe("lore apps instance --estate", () => {
  const create = () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const calls: Array<{ name: string; request: unknown }> = [];
    const command = alepha.inject(AppInstanceCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      estateApi: {
        listProjectEstates: async () => ({
          items: [
            { id: "e2", slug: "cheap" },
            { id: "e1", slug: "vps-ovh" },
          ],
        }),
      },
      appApi: {
        createApp: async (request: { body: { app: string; env: string } }) => {
          calls.push({ name: "create", request });
          return { app: request.body.app, env: request.body.env };
        },
        updateApp: async (request: {
          params: { app: string; env: string };
          body: Record<string, unknown>;
        }) => {
          calls.push({ name: "update", request });
          return { ...request.params, ...request.body };
        },
      },
    });
    const run = async (sub: "create" | "update", argv: string) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    return { run, printed, calls };
  };

  it("creates the copy and points it at the estate the slug names", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("create", "--app myapp --env production --estate vps-ovh");
    expect(calls).toEqual([
      {
        name: "create",
        request: {
          params: { projectId: 7 },
          body: { app: "myapp", env: "production" },
        },
      },
      {
        name: "update",
        request: {
          params: { projectId: 7, app: "myapp", env: "production" },
          body: { estateId: "e1" },
        },
      },
    ]);
    expect(printed.join("\n")).toContain("Created myapp/production on vps-ovh");
  });

  it("refuses an unknown slug before creating anything, naming the lent ones", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await expect(
      run("create", "--app myapp --env production --estate nope"),
    ).rejects.toThrow("Lent here: cheap, vps-ovh");
    expect(calls).toEqual([]);
  });

  it("updates the estate by slug, and still by id", async ({ expect }) => {
    const { run, calls } = create();
    await run("update", "--app myapp --env production --estate cheap");
    await run("update", "--app myapp --env production --estate-id e9");
    expect(calls.map((call) => call.request)).toEqual([
      {
        params: { projectId: 7, app: "myapp", env: "production" },
        body: { estateId: "e2" },
      },
      {
        params: { projectId: 7, app: "myapp", env: "production" },
        body: { estateId: "e9" },
      },
    ]);
  });

  it("refuses --estate and --estate-id together", async ({ expect }) => {
    const { run, calls } = create();
    await expect(
      run(
        "update",
        "--app myapp --env production --estate cheap --estate-id e9",
      ),
    ).rejects.toThrow("not both");
    expect(calls).toEqual([]);
  });
});
