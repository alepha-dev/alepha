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

import { RegistryCommand } from "../commands/RegistryCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore registry` (#Q2702): the token is read from stdin or a file, sent
 * once, and never printed; list shows hosts and usernames only.
 */
describe("lore registry", () => {
  const create = (stdin = "") => {
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
    const sent: unknown[] = [];
    const command = alepha.inject(RegistryCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: { getProjectBySlug: async () => ({ id: 7 }) },
      },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      readStdin: async () => stdin,
      api: {
        setRegistryCredential: async (request: {
          body: { host: string; username: string };
        }) => {
          sent.push(request);
          return {
            id: "r",
            host: request.body.host,
            username: request.body.username,
            updatedAt: "now",
          };
        },
        listRegistryCredentials: async () => ({
          items: [
            {
              id: "r",
              host: "registry.acme.io",
              username: "ci",
              updatedAt: "now",
            },
          ],
        }),
        removeRegistryCredential: async (request: unknown) => {
          sent.push(request);
          return { ok: true };
        },
      },
    });
    const run = async (sub: "add" | "list" | "remove", argv: string) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    return { alepha, run, printed, sent };
  };

  it("stores a credential read from stdin, and never prints the token", async ({
    expect,
  }) => {
    const { run, printed, sent } = create("glpat-secret-token\n");
    await run("add", "registry.acme.io -u ci --password-stdin");
    expect(sent).toEqual([
      {
        params: { projectId: 7 },
        body: {
          host: "registry.acme.io",
          username: "ci",
          secret: "glpat-secret-token",
        },
      },
    ]);
    expect(printed.join("\n")).not.toContain("glpat");
  });

  it("refuses an empty token rather than storing one", async ({ expect }) => {
    const { run, sent } = create("");
    await expect(
      run("add", "registry.acme.io -u ci --password-stdin"),
    ).rejects.toThrow("No token given");
    expect(sent).toEqual([]);
  });

  it("lists hosts and usernames, and removes one", async ({ expect }) => {
    const { run, printed, sent } = create();
    await run("list", "");
    expect(printed.join("\n")).toMatch(/registry\.acme\.io[\s\S]*ci/);
    await run("remove", "registry.acme.io");
    expect(sent).toEqual([
      { params: { projectId: 7 }, query: { host: "registry.acme.io" } },
    ]);
  });
});
