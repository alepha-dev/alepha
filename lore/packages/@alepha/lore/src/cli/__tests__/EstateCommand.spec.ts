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

import { EstateCommand } from "../commands/EstateCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore estate add` and `list` (#Q2699): the estate is created and lent to
 * the current project, and the connector command is printed once with its
 * secret; deploys stay off unless asked for.
 */
describe("lore estate", () => {
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
    const command = alepha.inject(EstateCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: { getProjectBySlug: async () => ({ id: 7 }) },
      },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      lending: {
        createProjectEstate: async (request: unknown) => {
          calls.push({ name: "create", request });
          return { id: "e1", slug: "vps-ovh", secret: "es_live_secret" };
        },
        listProjectEstates: async () => ({
          items: [
            {
              id: "e1",
              slug: "vps-ovh",
              type: "bay",
              online: true,
              deployAllowed: false,
              lastSeenAt: "2026-10-25T10:00:00Z",
            },
          ],
        }),
      },
      estates: {
        updateEstate: async (request: unknown) => {
          calls.push({ name: "update", request });
          return {};
        },
      },
    });
    const run = async (sub: "add" | "list", argv: string) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    return { run, printed, calls };
  };

  it("adds an estate to the project and prints the connector command with its secret, once", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("add", "vps-ovh");
    expect(calls).toEqual([
      {
        name: "create",
        request: { params: { projectId: 7 }, body: { slug: "vps-ovh" } },
      },
    ]);
    expect(printed.filter((line) => line.includes("es_live_secret"))).toEqual([
      "  bay connector set https://lore.test es_live_secret",
    ]);
    expect(printed.join("\n")).toContain("Deploys are off");
  });

  it("allows deploys when asked", async ({ expect }) => {
    const { run, calls } = create();
    await run("add", "vps-ovh --allow-deploys");
    expect(calls[1]).toEqual({
      name: "update",
      request: { params: { estateId: "e1" }, body: { deployAllowed: true } },
    });
  });

  it("lists the project's estates with their connection state", async ({
    expect,
  }) => {
    const { run, printed } = create();
    await run("list", "");
    expect(printed.join("\n")).toMatch(
      /vps-ovh[\s\S]*online[\s\S]*deploys off/,
    );
  });
});
