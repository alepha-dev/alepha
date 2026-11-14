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

import { LoreHostChoice } from "../../client/services/LoreHostChoice.ts";
import { HostCommand } from "../commands/HostCommand.ts";
import { LoreDeployer } from "../services/LoreDeployer.ts";
import { LoreHostResolver } from "../services/LoreHostResolver.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore host lend` / `unlend` (#Q3172): a host provisioned with no
 * project is lent from a shell later, and a deploy with nowhere to go says
 * which command fixes it.
 */
describe("lore host lend and unlend", () => {
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
    const command = alepha.inject(HostCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    Object.assign(
      alepha.inject(LoreHostResolver) as unknown as Record<string, unknown>,
      {
        hosts: {
          listMyHosts: async () => ({
            items: [
              {
                id: "est-1",
                slug: "small-skilled-pie",
                project: { id: 3, title: "Infra", slug: "infra" },
                can: ["host:read", "host:lend"],
                projects: [],
              },
            ],
          }),
        },
      },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      lending: {
        attachHost: async (request: unknown) => {
          calls.push({ name: "attach", request });
          return { id: "est-1", slug: "small-skilled-pie" };
        },
        detachHost: async (request: unknown) => {
          calls.push({ name: "detach", request });
          return { ok: true };
        },
        listProjectHosts: async () => ({
          items: [
            {
              id: "est-1",
              slug: "small-skilled-pie",
              home: { id: 3, title: "Infra", slug: "infra" },
              isHome: false,
              can: [],
            },
          ],
        }),
      },
    });
    const run = async (cmd: "lend" | "unlend", argv: string) => {
      await alepha.inject(CliProvider).run(command[cmd] as never, { argv });
    };
    return { run, printed, calls };
  };

  it("lends a host to a project and says how to deploy there", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("lend", "small-skilled-pie --project hello-world");
    expect(calls).toEqual([
      {
        name: "attach",
        request: { params: { projectId: 7 }, body: { hostId: "est-1" } },
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
        request: { params: { projectId: 7, hostId: "est-1" } },
      },
    ]);
  });

  it("refuses a host the caller may not lend", async ({ expect }) => {
    const { run, calls } = create();
    await expect(run("lend", "other --project hello-world")).rejects.toThrow(
      "No host named other that you can lend",
    );
    expect(calls).toEqual([]);
  });

  it("a deploy with no host lent prints the commands that fix it", ({
    expect,
  }) => {
    expect(() =>
      LoreHostChoice.pick([], undefined, "hello/production"),
    ).toThrow("lore host provision --provider scaleway --project <project>");
    expect(() =>
      LoreHostChoice.pick(
        [
          { id: "a", slug: "a" },
          { id: "b", slug: "b" },
        ],
        undefined,
        "hello/production",
      ),
    ).toThrow(
      "lore apps instance create --app <app> --env <env> --host <slug>",
    );
  });

  it("names the host a copy deploys to, for the line every deploy prints", async ({
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
      hosts: {
        listProjectHosts: async () => ({
          items: [{ id: "est-1", slug: "small-skilled-pie" }],
        }),
      },
    });
    expect(
      await deployer.destinationOf(7, { id: "i", hostId: "est-1" } as never),
    ).toBe("host 'small-skilled-pie'");
    expect(
      await deployer.destinationOf(7, { id: "i" } as never),
    ).toBeUndefined();
  });

  it("refuses a slug two lent hosts share, naming their home projects", ({
    expect,
  }) => {
    expect(() =>
      LoreHostChoice.pick(
        [
          { id: "a", slug: "ovh-1", home: { slug: "infra", title: "Infra" } },
          { id: "b", slug: "ovh-1", home: { slug: "shop", title: "Shop" } },
        ],
        "ovh-1",
        "hello/production",
      ),
    ).toThrow("from infra and shop");
  });

  it("lends the one host --home names when two share a slug", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await run("lend", "small-skilled-pie --project hello-world --home infra");
    expect(calls).toEqual([
      {
        name: "attach",
        request: { params: { projectId: 7 }, body: { hostId: "est-1" } },
      },
    ]);
    await expect(
      run("lend", "small-skilled-pie --project hello-world --home elsewhere"),
    ).rejects.toThrow("in elsewhere");
  });
});
