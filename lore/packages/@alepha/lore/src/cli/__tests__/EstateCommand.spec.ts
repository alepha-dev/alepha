import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleInputProvider,
  ConsoleOutputProvider,
  MemoryInputProvider,
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
import { LoreEstateResolver } from "../services/LoreEstateResolver.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore estate add` and `list` (#Q2699): the estate is created and lent to
 * the current project, and the connector command is printed once with its
 * secret; deploys stay off unless asked for. `stats` (#Q3047) reads one of
 * the caller's own estates by slug.
 */
describe("lore estate", () => {
  const create = (onlineAfter = 0) => {
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
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .with({ provide: ConsoleInputProvider, use: MemoryInputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const calls: Array<{ name: string; request: unknown }> = [];
    const command = alepha.inject(EstateCommand);
    Object.assign(command as unknown as Record<string, unknown>, {
      pollMillis: 50,
    });
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: { getProjectBySlug: async () => ({ id: 7 }) },
      },
    );
    let reads = 0;
    const estates = {
      getEstate: async () => {
        reads++;
        return {
          id: "e1",
          slug: "vps-ovh",
          type: "bay",
          online: reads > onlineAfter,
          deployAllowed: true,
          lastSeenAt: reads > onlineAfter ? "2026-11-06T10:00:00Z" : undefined,
          projects: [{ id: 7, title: "Hello", slug: "hello", lentAt: "x" }],
        };
      },
      getEstateInventory: async () => ({ inventory: null, expected: [] }),
      updateEstate: async (request: unknown) => {
        calls.push({ name: "update", request });
        return {};
      },
      deleteEstate: async (request: unknown) => {
        calls.push({ name: "delete", request });
        return { ok: true };
      },
      listMyEstates: async () => ({
        items: [
          {
            id: "e1",
            slug: "vps-ovh",
            type: "bay",
            cpuPercent: 34.4,
            memoryPercent: 61.6,
            statsAt: "2026-11-02T10:00:00Z",
          },
        ],
      }),
      getEstateStats: async (request: unknown) => {
        calls.push({ name: "stats", request });
        return {
          collecting: true,
          estimated: false,
          points: [
            {
              day: "2026-11-01",
              cpuPercent: 20.2,
              memoryPercent: 55,
              samples: 288,
            },
          ],
        };
      },
    };
    Object.assign(
      alepha.inject(LoreEstateResolver) as unknown as Record<string, unknown>,
      { estates },
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
              cpuPercent: 34.4,
              memoryPercent: 61.6,
            },
          ],
        }),
      },
      estates,
    });
    const run = async (
      sub: "add" | "list" | "get" | "wait" | "stats" | "delete",
      argv: string,
    ) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    const input = alepha.inject(MemoryInputProvider);
    return { run, printed, calls, input };
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

  it("prints the minted estate as one JSON document for a script, and nothing else", async ({
    expect,
  }) => {
    const { run, printed } = create();
    await run("add", "vps-ovh --allow-deploys --output json");
    expect(JSON.parse(printed.join("\n"))).toEqual({
      id: "e1",
      slug: "vps-ovh",
      deployAllowed: true,
      lore: "https://lore.test",
      secret: "es_live_secret",
      command: "bay connector set https://lore.test es_live_secret",
    });
  });

  it("reports deploys off in JSON when they were not allowed", async ({
    expect,
  }) => {
    const { run, printed } = create();
    await run("add", "vps-ovh --output json");
    expect(JSON.parse(printed.join("\n")).deployAllowed).toBe(false);
  });

  it("lists the project's estates with their connection state", async ({
    expect,
  }) => {
    const { run, printed } = create();
    await run("list", "");
    expect(printed.join("\n")).toMatch(
      /vps-ovh[\s\S]*online CPU 34% RAM 62%[\s\S]*deploys off/,
    );
  });

  it("prints an estate's current reading and its daily means", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("stats", "vps-ovh --since 2026-10-01");
    expect(calls).toEqual([
      {
        name: "stats",
        request: { params: { estateId: "e1" }, query: { since: "2026-10-01" } },
      },
    ]);
    const out = printed.join("\n");
    expect(out).toContain("CPU 34%  RAM 62%");
    expect(out).toContain("2026-11-01  CPU  20%  RAM  55%  288 samples");
  });

  it("refuses an estate the caller does not own, and reads nothing", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await expect(run("stats", "someone-elses")).rejects.toThrow(
      "You own no estate named someone-elses",
    );
    expect(calls).toEqual([]);
  });

  describe("delete (#Q3131)", () => {
    it("deletes one of the caller's own estates with --yes and says nothing on the machine stopped", async ({
      expect,
    }) => {
      const { run, printed, calls } = create();
      await run("delete", "vps-ovh --yes");
      expect(calls).toEqual([
        { name: "delete", request: { params: { estateId: "e1" } } },
      ]);
      const out = printed.join("\n");
      expect(out).toContain("Deleted vps-ovh. Its secret is revoked");
      expect(out).toContain("Nothing on the machine was stopped");
    });

    it("prints JSON for a script", async ({ expect }) => {
      const { run, printed } = create();
      await run("delete", "vps-ovh --yes --output json");
      expect(JSON.parse(printed.join("\n"))).toEqual({
        ok: true,
        id: "e1",
        slug: "vps-ovh",
        revoked: true,
      });
    });

    it("refuses without --yes when there is no terminal to ask on, and deletes nothing", async ({
      expect,
    }) => {
      const { run, calls } = create();
      await expect(run("delete", "vps-ovh")).rejects.toThrow("Pass --yes");
      expect(calls).toEqual([]);
    });

    it("refuses an estate the caller does not own", async ({ expect }) => {
      const { run, calls } = create();
      await expect(run("delete", "someone-elses --yes")).rejects.toThrow(
        "You own no estate named someone-elses",
      );
      expect(calls).toEqual([]);
    });
  });

  describe("get and wait (#Q3133)", () => {
    it("reads one of the caller's estates and says plainly when it never connected", async ({
      expect,
    }) => {
      const { run, printed } = create();
      await run("get", "vps-ovh");
      const out = printed.join("\n");
      expect(out).toMatch(/State:\s+online/);
      expect(out).toMatch(/Lent to:\s+hello/);
      expect(out).toContain("Never connected");
    });

    it("prints the estate and its inventory as JSON", async ({ expect }) => {
      const { run, printed } = create();
      await run("get", "vps-ovh --output json");
      const json = JSON.parse(printed.join("\n"));
      expect(json.slug).toBe("vps-ovh");
      expect(json.inventory).toBeNull();
    });

    it("waits until the estate is online, then exits 0", async ({ expect }) => {
      const { run, printed } = create(2);
      await run("wait", "vps-ovh --timeout 5");
      expect(printed.join("\n")).toContain("vps-ovh is online");
    });

    it("fails on timeout with the last state seen", async ({ expect }) => {
      const { run } = create(1_000);
      await expect(run("wait", "vps-ovh --timeout 1")).rejects.toThrow(
        "vps-ovh is still offline after 1s (last seen never)",
      );
    });
  });
});
