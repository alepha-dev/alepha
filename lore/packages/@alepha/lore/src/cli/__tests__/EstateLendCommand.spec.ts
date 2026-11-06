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

import { LoreEstateChoice } from "../../client/services/LoreEstateChoice.ts";
import { EstateCommand } from "../commands/EstateCommand.ts";
import { LoreDeployer } from "../services/LoreDeployer.ts";
import { LoreEstateResolver } from "../services/LoreEstateResolver.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore estate lend` / `unlend` (#Q3172): an estate provisioned with no
 * project is lent from a shell later, and a deploy with nowhere to go says
 * which command fixes it.
 */
describe("lore estate lend and unlend", () => {
  const create = () => {
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
    const command = alepha.inject(EstateCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    Object.assign(
      alepha.inject(LoreEstateResolver) as unknown as Record<string, unknown>,
      {
        estates: {
          listMyEstates: async () => ({
            items: [{ id: "est-1", slug: "small-skilled-pie" }],
          }),
        },
      },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      lending: {
        attachEstate: async (request: unknown) => {
          calls.push({ name: "attach", request });
          return { id: "est-1", slug: "small-skilled-pie" };
        },
        detachEstate: async (request: unknown) => {
          calls.push({ name: "detach", request });
          return { ok: true };
        },
      },
    });
    const run = async (cmd: "lend" | "unlend", argv: string) => {
      await alepha.inject(CliProvider).run(command[cmd] as never, { argv });
    };
    return { run, printed, calls };
  };

  it("lends one of your estates to a project and says how to deploy there", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("lend", "small-skilled-pie --project hello-world");
    expect(calls).toEqual([
      {
        name: "attach",
        request: { params: { projectId: 7 }, body: { estateId: "est-1" } },
      },
    ]);
    expect(printed.join("\n")).toContain(
      "Lent small-skilled-pie to hello-world.",
    );
    expect(printed.join("\n")).toContain("alepha deploy");
  });

  it("withdraws the loan", async ({ expect }) => {
    const { run, calls } = create();
    await run("unlend", "small-skilled-pie --project hello-world");
    expect(calls).toEqual([
      {
        name: "detach",
        request: { params: { projectId: 7, estateId: "est-1" } },
      },
    ]);
  });

  it("refuses an estate you do not own", async ({ expect }) => {
    const { run, calls } = create();
    await expect(run("lend", "other --project hello-world")).rejects.toThrow(
      "You own no estate named other",
    );
    expect(calls).toEqual([]);
  });

  it("a deploy with no estate lent prints the commands that fix it", ({
    expect,
  }) => {
    expect(() =>
      LoreEstateChoice.pick([], undefined, "hello/production"),
    ).toThrow("lore estate provision --provider scaleway --project <project>");
    expect(() =>
      LoreEstateChoice.pick(
        [
          { id: "a", slug: "a" },
          { id: "b", slug: "b" },
        ],
        undefined,
        "hello/production",
      ),
    ).toThrow(
      "lore apps instance create --app <app> --env <env> --estate <slug>",
    );
  });

  it("names the estate a copy deploys to, for the line every deploy prints", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
      },
    });
    const deployer = alepha.inject(LoreDeployer);
    Object.assign(deployer as unknown as Record<string, unknown>, {
      estates: {
        listProjectEstates: async () => ({
          items: [{ id: "est-1", slug: "small-skilled-pie" }],
        }),
      },
    });
    expect(
      await deployer.destinationOf(7, { id: "i", estateId: "est-1" } as never),
    ).toBe("estate 'small-skilled-pie'");
    expect(
      await deployer.destinationOf(7, { id: "i" } as never),
    ).toBeUndefined();
  });
});
