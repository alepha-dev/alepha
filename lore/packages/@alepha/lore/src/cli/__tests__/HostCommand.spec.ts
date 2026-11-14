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

import { HostCommand } from "../commands/HostCommand.ts";
import { LoreHostResolver } from "../services/LoreHostResolver.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore host add` and `list` (#Q2699): the host is created and lent to
 * the current project, and the connector command is printed once with its
 * secret; deploys stay off unless asked for. `stats` (#Q3047) reads one of
 * the caller's own hosts by slug.
 */
/**
 * A host of project `hello` (id 7), as its owner lists it (#E126).
 */
const HOMED = {
  id: "e1",
  slug: "vps-ovh",
  type: "bay",
  cpuPercent: 34.4,
  memoryPercent: 61.6,
  statsAt: "2026-11-02T10:00:00Z",
  project: { id: 7, title: "Hello", slug: "hello" },
  can: ["host:read", "host:update", "host:delete", "host:lend"],
  projects: [{ id: 7, title: "Hello", slug: "hello", lentAt: "x" }],
};

describe("lore host", () => {
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
    const command = alepha.inject(HostCommand);
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
    const hosts = {
      getHost: async () => {
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
      getHostInventory: async () => ({ inventory: null, expected: [] }),
      updateHost: async (request: unknown) => {
        calls.push({ name: "update", request });
        const body = (request as { body: Record<string, unknown> }).body;
        return { slug: "vps-ovh", ...body };
      },
      rotateHost: async (request: unknown) => {
        calls.push({ name: "rotate", request });
        return {
          id: "e1",
          slug: "vps-ovh",
          deployAllowed: true,
          secret: "es_live_rotated",
        };
      },
      deleteHost: async (request: unknown) => {
        calls.push({ name: "delete", request });
        return { ok: true };
      },
      moveHost: async (request: unknown) => {
        calls.push({ name: "move", request });
        return {
          host: { id: "e1", slug: "vps-ovh" },
          loans: [{ id: 7, title: "Hello", slug: "hello" }],
          serverElsewhere: false,
        };
      },
      listMyHosts: async () => ({ items: [HOMED] }),
      getHostStats: async (request: unknown) => {
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
      alepha.inject(LoreHostResolver) as unknown as Record<string, unknown>,
      {
        hosts,
        // The hosts project `hello` (id 7) is the home of (#E126).
        lending: { listHomeHosts: async () => ({ items: [HOMED] }) },
      },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      lending: {
        createProjectHost: async (request: unknown) => {
          calls.push({ name: "create", request });
          return { id: "e1", slug: "vps-ovh", secret: "es_live_secret" };
        },
        listProjectHosts: async () => ({
          items: [
            {
              id: "e1",
              slug: "vps-ovh",
              type: "bay",
              online: true,
              deployAllowed: false,
              overdue: true,
              lastSeenAt: "2026-10-25T10:00:00Z",
              cpuPercent: 34.4,
              memoryPercent: 61.6,
              home: { id: 7, title: "Hello", slug: "hello" },
              isHome: true,
              can: ["host:read"],
            },
          ],
        }),
      },
      hosts,
      admin: {
        assignHost: async (request: unknown) => {
          calls.push({ name: "assign", request });
          return {
            project: { id: 7, title: "Hello", slug: "hello" },
            loans: [],
          };
        },
      },
    });
    const run = async (
      sub:
        | "add"
        | "list"
        | "get"
        | "wait"
        | "stats"
        | "update"
        | "rotate"
        | "move"
        | "assign"
        | "delete",
      argv: string,
    ) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    const input = alepha.inject(MemoryInputProvider);
    return { run, printed, calls, input };
  };

  it("adds a host to the project and prints the connector command with its secret, once", async ({
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
      request: { params: { hostId: "e1" }, body: { deployAllowed: true } },
    });
  });

  it("prints the minted host as one JSON document for a script, and nothing else", async ({
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

  it("lists the project's hosts with their connection state", async ({
    expect,
  }) => {
    const { run, printed } = create();
    await run("list", "");
    expect(printed.join("\n")).toMatch(
      /vps-ovh[\s\S]*online CPU 34% RAM 62%[\s\S]*deploys off, OVERDUE/,
    );
  });

  it("prints a host's current reading and its daily means", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("stats", "vps-ovh --since 2026-10-01");
    expect(calls).toEqual([
      {
        name: "stats",
        request: { params: { hostId: "e1" }, query: { since: "2026-10-01" } },
      },
    ]);
    const out = printed.join("\n");
    expect(out).toContain("CPU 34%  RAM 62%");
    expect(out).toContain("2026-11-01  CPU  20%  RAM  55%  288 samples");
  });

  it("refuses a host the caller cannot read, and reads nothing", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await expect(run("stats", "someone-elses")).rejects.toThrow(
      "No host named someone-elses that you can read",
    );
    expect(calls).toEqual([]);
  });

  describe("delete (#Q3131)", () => {
    it("deletes a host of the project with --yes and says nothing on the machine stopped", async ({
      expect,
    }) => {
      const { run, printed, calls } = create();
      await run("delete", "vps-ovh --yes");
      expect(calls).toEqual([
        { name: "delete", request: { params: { hostId: "e1" } } },
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

    it("refuses a host the project is not the home of", async ({ expect }) => {
      const { run, calls } = create();
      await expect(run("delete", "someone-elses --yes")).rejects.toThrow(
        "is the home of no host named someone-elses",
      );
      expect(calls).toEqual([]);
    });
  });

  describe("get and wait (#Q3133)", () => {
    it("reads a host and says plainly when it never connected", async ({
      expect,
    }) => {
      const { run, printed } = create();
      await run("get", "vps-ovh");
      const out = printed.join("\n");
      expect(out).toMatch(/State:\s+online/);
      expect(out).toMatch(/Lent to:\s+hello/);
      expect(out).toContain("Never connected");
    });

    it("prints the host and its inventory as JSON", async ({ expect }) => {
      const { run, printed } = create();
      await run("get", "vps-ovh --output json");
      const json = JSON.parse(printed.join("\n"));
      expect(json.slug).toBe("vps-ovh");
      expect(json.inventory).toBeNull();
    });

    it("waits until the host is online, then exits 0", async ({ expect }) => {
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

  describe("update and rotate (#Q3134)", () => {
    it("turns deploys on, off again, and sets the label", async ({
      expect,
    }) => {
      const { run, printed, calls } = create();
      await run("update", "vps-ovh --allow-deploys --label ovh");
      await run("update", "vps-ovh --no-allow-deploys");
      expect(calls).toEqual([
        {
          name: "update",
          request: {
            params: { hostId: "e1" },
            body: { deployAllowed: true, label: "ovh" },
          },
        },
        {
          name: "update",
          request: {
            params: { hostId: "e1" },
            body: { deployAllowed: false },
          },
        },
      ]);
      expect(printed.join("\n")).toContain("Updated vps-ovh: deploys off");
    });

    it("refuses an update with nothing to change", async ({ expect }) => {
      const { run, calls } = create();
      await expect(run("update", "vps-ovh")).rejects.toThrow(
        "Nothing to change",
      );
      expect(calls).toEqual([]);
    });

    it("rotates with --yes and prints the new connector command once, as JSON in add's shape", async ({
      expect,
    }) => {
      const { run, printed, calls } = create();
      await run("rotate", "vps-ovh --yes --output json");
      expect(calls).toEqual([
        { name: "rotate", request: { params: { hostId: "e1" } } },
      ]);
      expect(JSON.parse(printed.join("\n"))).toEqual({
        id: "e1",
        slug: "vps-ovh",
        deployAllowed: true,
        lore: "https://lore.test",
        secret: "es_live_rotated",
        command: "bay connector set https://lore.test es_live_rotated",
      });
    });

    it("refuses to rotate without --yes when there is no terminal", async ({
      expect,
    }) => {
      const { run, calls } = create();
      await expect(run("rotate", "vps-ovh")).rejects.toThrow("Pass --yes");
      expect(calls).toEqual([]);
    });
  });

  describe("--ttl (#Q3138)", () => {
    it("sends a TTL in seconds with add, in the same update as --allow-deploys", async ({
      expect,
    }) => {
      const { run, calls } = create();
      await run("add", "vps-ovh --allow-deploys --ttl 2h");
      expect(calls[1]).toEqual({
        name: "update",
        request: {
          params: { hostId: "e1" },
          body: { deployAllowed: true, ttlSeconds: 7200 },
        },
      });
    });

    it("extends with update, clears with none, and refuses a malformed one", async ({
      expect,
    }) => {
      const { run, calls } = create();
      await run("update", "vps-ovh --ttl 3d");
      await run("update", "vps-ovh --ttl none");
      expect(
        calls.map((call) => (call.request as { body: object }).body),
      ).toEqual([{ ttlSeconds: 259_200 }, { ttlSeconds: null }]);
      await expect(run("update", "vps-ovh --ttl 2 hours")).rejects.toThrow(
        "write a number and m, h or d",
      );
    });
  });

  describe("move and assign (#Q3282)", () => {
    it("moves a host of the project with --yes and prints the loans that stay", async ({
      expect,
    }) => {
      const { run, printed, calls } = create();
      await run("move", "vps-ovh --to hello --yes");
      expect(calls).toEqual([
        {
          name: "move",
          request: { params: { hostId: "e1" }, body: { projectId: 7 } },
        },
      ]);
      expect(printed.join("\n")).toContain("Still lent to: hello.");
    });

    it("refuses to move without --yes when there is no terminal", async ({
      expect,
    }) => {
      const { run, calls } = create();
      await expect(run("move", "vps-ovh --to hello")).rejects.toThrow(
        "Pass --yes",
      );
      expect(calls).toEqual([]);
    });

    it("assigns a host by id, for an admin", async ({ expect }) => {
      const { run, printed, calls } = create();
      await run("assign", "e9 --to hello");
      expect(calls).toEqual([
        {
          name: "assign",
          request: { params: { id: "e9" }, body: { projectId: 7 } },
        },
      ]);
      expect(printed.join("\n")).toContain("now belongs to hello");
    });
  });

  it("says whether the project is a host's home or borrows it", async ({
    expect,
  }) => {
    const { run, printed } = create();
    await run("list", "");
    expect(printed.join("\n")).toContain("bay, home");
  });
});
