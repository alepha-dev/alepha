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
 * `lore apps instance create | update --host <slug>` (#Q3140): the host
 * is named by slug among those lent to the project, in the same command that
 * creates the copy, and `--host-id` stays beside it for a script holding an
 * id.
 */
describe("lore apps instance --host", () => {
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
      hostApi: {
        listProjectHosts: async () => ({
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

  it("creates the copy and points it at the host the slug names", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("create", "--app myapp --env production --host vps-ovh");
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
          body: { hostId: "e1" },
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
      run("create", "--app myapp --env production --host nope"),
    ).rejects.toThrow("Lent here: cheap, vps-ovh");
    expect(calls).toEqual([]);
  });

  it("updates the host by slug, and still by id", async ({ expect }) => {
    const { run, calls } = create();
    await run("update", "--app myapp --env production --host cheap");
    await run("update", "--app myapp --env production --host-id e9");
    expect(calls.map((call) => call.request)).toEqual([
      {
        params: { projectId: 7, app: "myapp", env: "production" },
        body: { hostId: "e2" },
      },
      {
        params: { projectId: 7, app: "myapp", env: "production" },
        body: { hostId: "e9" },
      },
    ]);
  });

  it("refuses --host and --host-id together", async ({ expect }) => {
    const { run, calls } = create();
    await expect(
      run("update", "--app myapp --env production --host cheap --host-id e9"),
    ).rejects.toThrow("not both");
    expect(calls).toEqual([]);
  });
});
