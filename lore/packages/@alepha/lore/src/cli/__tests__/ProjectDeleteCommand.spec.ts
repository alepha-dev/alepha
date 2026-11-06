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

import { ProjectCommand } from "../commands/ProjectCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore project delete <slug> --confirm <slug>` (#Q3154): the owner's delete
 * from a shell, the slug typed twice, what goes with it printed first.
 */
describe("lore project delete", () => {
  const create = (options: { foliosRefused?: boolean } = {}) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const calls: Array<{ name: string; request: unknown }> = [];
    const command = alepha.inject(ProjectCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 42 }) } },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      areaApi: {
        getAreas: async () => [
          { name: "a", questCount: 3, openQuestCount: 1 },
          { name: "b", questCount: 2, openQuestCount: 0 },
        ],
      },
      folioApi: {
        index: async () => {
          if (options.foliosRefused) {
            throw new Error("Knowledge is off");
          }
          return [{ id: "f1" }, { id: "f2" }];
        },
      },
      appApi: { listApps: async () => ({ items: [{ id: "i1" }], apps: [] }) },
      projectApi: {
        deleteProjectById: async (request: unknown) => {
          calls.push({ name: "delete", request });
          return { ok: true };
        },
      },
    });
    const run = async (argv: string) => {
      await alepha.inject(CliProvider).run(command.delete as never, { argv });
    };
    return { run, printed, calls };
  };

  it("deletes with the slug confirmed, and says what went with it", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("tuto-verify --confirm tuto-verify");
    expect(calls).toEqual([
      { name: "delete", request: { params: { id: 42 } } },
    ]);
    expect(printed.join("\n")).toContain(
      "Deleted tuto-verify took with it: 5 quests, 2 folios, 1 deployed copies",
    );
  });

  it("prints the plan and refuses without --confirm, deleting nothing", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await expect(run("tuto-verify")).rejects.toThrow(
      "lore project delete tuto-verify --confirm tuto-verify",
    );
    expect(printed.join("\n")).toContain(
      "Deleting tuto-verify takes with it: 5 quests, 2 folios, 1 deployed copies",
    );
    expect(calls).toEqual([]);
  });

  it("refuses a confirmation that does not match", async ({ expect }) => {
    const { run, calls } = create();
    await expect(run("tuto-verify --confirm tuto")).rejects.toThrow(
      "does not match",
    );
    expect(calls).toEqual([]);
  });

  it("says unknown, not zero, for a count its capabilities refuse", async ({
    expect,
  }) => {
    const { run, printed } = create({ foliosRefused: true });
    await expect(run("tuto-verify")).rejects.toThrow();
    expect(printed.join("\n")).toContain("? folios");
  });
});
