import { Alepha } from "alepha";
import {
  CliProvider,
  CommandError,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { BadRequestError } from "alepha/server";
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

const BY_HAND =
  "curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=0.40.0 BAY_UPDATE_UNIT=yes sh";

interface World {
  /**
   * The statuses the queue answers, one per read, after the enqueue: the
   * last one is repeated.
   */
  reads?: Array<{ status: string; step?: string; reason?: string }>;
  /**
   * A refusal at enqueue: the sentence the server sends with its 400.
   */
  refuse?: string;
  inventory?: Record<string, unknown> | null;
  listed?: Array<Record<string, unknown>>;
}

/**
 * `lore host upgrade` (#Q3740): the upgrade of a host's Bay from a shell, and
 * the Bay version in `lore host list` and `lore host get`.
 */
describe("lore host upgrade", () => {
  const create = (world: World = {}) => {
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
    const command = alepha.inject(HostCommand);
    const home = {
      id: "e1",
      slug: "vps-ovh",
      type: "bay",
      project: { id: 7, title: "Hello", slug: "hello" },
      can: ["host:read", "host:update"],
      projects: [],
    };
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    Object.assign(
      alepha.inject(LoreHostResolver) as unknown as Record<string, unknown>,
      {
        hosts: { listMyHosts: async () => ({ items: [home] }) },
        lending: { listHomeHosts: async () => ({ items: [home] }) },
      },
    );
    let version = "0.40.0";
    let read = 0;
    Object.assign(command as unknown as Record<string, unknown>, {
      pollMillis: 5,
      commands: {
        enqueueHostCommand: async (request: { body: { version?: string } }) => {
          calls.push({ name: "enqueue", request });
          if (world.refuse) {
            // What the client raises for a 400 the server answered.
            throw new BadRequestError(world.refuse);
          }
          version = request.body.version ?? version;
          return {
            id: "c1",
            kind: "upgrade",
            status: "sent",
            payload: {
              app: "",
              environment: "",
              version,
              fromVersion: "0.39.0",
            },
          };
        },
        listHostCommands: async () => {
          const reads = world.reads ?? [{ status: "done" }];
          const now = reads[Math.min(read, reads.length - 1)]!;
          read += 1;
          return {
            items: [
              {
                id: "c1",
                kind: "upgrade",
                payload: {
                  app: "",
                  environment: "",
                  version,
                  fromVersion: "0.39.0",
                },
                ...now,
              },
            ],
          };
        },
      },
      hosts: {
        getHost: async () => ({
          ...home,
          online: true,
          deployAllowed: true,
          lastSeenAt: "2026-11-17T10:00:00Z",
        }),
        getHostInventory: async () => ({
          inventory: world.inventory ?? null,
          expected: [],
        }),
        listMyHosts: async () => ({ items: [home] }),
      },
      lending: {
        listProjectHosts: async () => ({ items: world.listed ?? [] }),
      },
    });
    const run = async (sub: "upgrade" | "list" | "get", argv: string) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    return { run, printed, calls, reads: () => read };
  };

  const exitCodeOf = async (work: Promise<unknown>): Promise<number> => {
    try {
      await work;
    } catch (error) {
      if (error instanceof CommandError) {
        return error.data.exitCode ?? 1;
      }
      throw error;
    }
    return 0;
  };

  it("sends the upgrade with no version, waits for it to settle, and prints the new version", async ({
    expect,
  }) => {
    const { run, printed, calls, reads } = create({
      reads: [
        { status: "running", step: "downloading" },
        { status: "running", step: "handing over" },
        { status: "done" },
      ],
    });
    await run("upgrade", "vps-ovh");
    expect(calls).toEqual([
      {
        name: "enqueue",
        // No version: the server sends the release it installs.
        request: { params: { hostId: "e1" }, body: { kind: "upgrade" } },
      },
    ]);
    expect(reads()).toBe(3);
    expect(printed).toEqual(["vps-ovh now runs Bay 0.40.0 (was 0.39.0)."]);
  });

  it("names another version with --version", async ({ expect }) => {
    const { run, printed, calls } = create();
    await run("upgrade", "vps-ovh --version 0.40.2");
    expect(calls[0]?.request).toEqual({
      params: { hostId: "e1" },
      body: { kind: "upgrade", version: "0.40.2" },
    });
    expect(printed).toEqual(["vps-ovh now runs Bay 0.40.2 (was 0.39.0)."]);
  });

  it("returns once queued with --no-wait, reading the queue no further", async ({
    expect,
  }) => {
    const { run, printed, reads } = create();
    await run("upgrade", "vps-ovh --no-wait");
    expect(reads()).toBe(0);
    expect(printed.join("\n")).toContain(
      "Queued the upgrade of vps-ovh from Bay 0.39.0 to 0.40.0",
    );
  });

  it("prints the settled command as one JSON document for a script", async ({
    expect,
  }) => {
    const { run, printed } = create();
    await run("upgrade", "vps-ovh --output json");
    expect(JSON.parse(printed.join("\n"))).toMatchObject({
      id: "c1",
      kind: "upgrade",
      status: "done",
      payload: { version: "0.40.0", fromVersion: "0.39.0" },
    });
  });

  it("fails with the machine's own reason when the new version did not take over", async ({
    expect,
  }) => {
    const { run } = create({
      reads: [
        {
          status: "failed",
          step: "handing over",
          reason: "0.40.0 did not take over, so this Bay keeps serving 0.39.0",
        },
      ],
    });
    const attempt = run("upgrade", "vps-ovh");
    await expect(attempt).rejects.toThrow(
      "vps-ovh was not upgraded to Bay 0.40.0: 0.40.0 did not take over, so this Bay keeps serving 0.39.0",
    );
    expect(
      await exitCodeOf(
        create({ reads: [{ status: "failed" }] }).run("upgrade", "vps-ovh"),
      ),
    ).toBe(1);
  });

  it("gives up after --timeout, saying where the upgrade was", async ({
    expect,
  }) => {
    const { run } = create({
      reads: [{ status: "running", step: "downloading" }],
    });
    await expect(run("upgrade", "vps-ovh --timeout 1")).rejects.toThrow(
      "has not settled after 1s (downloading)",
    );
  });

  for (const [what, message] of [
    [
      "deploys off",
      'Host "vps-ovh" does not accept deploys; its home project has to allow them first',
    ],
    [
      "an offline host",
      'Host "vps-ovh" is not connected right now, so its Bay cannot be upgraded',
    ],
    [
      "a Bay version Lore cannot compare",
      'Host "vps-ovh" runs a Bay with no release version (dev)',
    ],
    [
      "an older version",
      'Host "vps-ovh" runs Bay 0.39.0, and Lore does not take a host back to 0.38.0',
    ],
    [
      "a host that is upgraded by hand, with the command to run",
      `Host "vps-ovh" cannot be upgraded from Lore: its systemd unit lacks the handoff drop-in. Upgrade it on the machine, once: ${BY_HAND}`,
    ],
  ] as const) {
    it(`prints the server's reason and exits non-zero for ${what}`, async ({
      expect,
    }) => {
      const world = { refuse: message };
      const { run, reads } = create(world);
      await expect(run("upgrade", "vps-ovh")).rejects.toThrow(message);
      expect(reads()).toBe(0);
      expect(await exitCodeOf(create(world).run("upgrade", "vps-ovh"))).toBe(1);
    });
  }

  it("refuses a host the project only borrows, before asking the server anything", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await expect(run("upgrade", "someone-elses")).rejects.toThrow(
      "is the home of no host named someone-elses",
    );
    expect(calls).toEqual([]);
  });

  it("shows the Bay version in the list, and the target when a host is behind", async ({
    expect,
  }) => {
    const row = {
      type: "bay",
      online: true,
      deployAllowed: true,
      overdue: false,
      isHome: true,
      can: ["host:read"],
    };
    const { run, printed } = create({
      listed: [
        {
          ...row,
          id: "e1",
          slug: "vps-ovh",
          bayVersion: "0.39.0",
          upgradeAvailable: true,
          targetBayVersion: "0.40.0",
        },
        {
          ...row,
          id: "e2",
          slug: "vps-new",
          bayVersion: "0.40.0",
          upgradeAvailable: false,
        },
        { ...row, id: "e3", slug: "vps-silent", upgradeAvailable: false },
      ],
    });
    await run("list", "");
    const lines = printed.join("\n").split("\n");
    expect(lines[0]).toContain(
      "deploys allowed, Bay 0.39.0 (0.40.0 available)",
    );
    expect(lines[1]).toContain("deploys allowed, Bay 0.40.0");
    expect(lines[1]).not.toContain("available");
    expect(lines[2]).not.toContain("Bay ");
  });

  it("shows the target and the upgrade mode in host get", async ({
    expect,
  }) => {
    const reported = {
      at: "2026-11-17T10:00:00Z",
      reportedAt: "2026-11-17T10:00:00Z",
      bayVersion: "0.39.0",
      targetBayVersion: "0.40.0",
      machine: {},
      apps: [],
    };
    const behind = create({
      inventory: {
        ...reported,
        upgradeMode: "handoff",
        upgradeAvailable: true,
        upgradeByHand: false,
      },
    });
    await behind.run("get", "vps-ovh");
    expect(behind.printed.join("\n")).toMatch(
      /Bay:?\s+0\.39\.0, 0\.40\.0 available \(upgrade mode: handoff\): lore host upgrade vps-ovh/,
    );

    const byHand = create({
      inventory: {
        ...reported,
        upgradeAvailable: true,
        upgradeByHand: true,
      },
    });
    await byHand.run("get", "vps-ovh");
    expect(byHand.printed.join("\n")).toMatch(
      /0\.39\.0, 0\.40\.0 available \(upgrade mode: none reported\): upgraded by hand, on the machine/,
    );

    const current = create({
      inventory: {
        ...reported,
        bayVersion: "0.40.0",
        upgradeMode: "handoff",
        upgradeAvailable: false,
        upgradeByHand: false,
      },
    });
    await current.run("get", "vps-ovh");
    expect(current.printed.join("\n")).toMatch(
      /Bay:?\s+0\.40\.0 \(upgrade mode: handoff\)/,
    );
  });
});
