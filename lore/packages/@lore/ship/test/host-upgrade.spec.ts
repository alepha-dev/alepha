import {
  BayReleaseTarget,
  HostCommandTransport,
  HostCommandService,
} from "@lore/core/api";
import {
  BayUpgrade,
  type Host,
  type HostCommandFrame,
  type HostServerFrame,
  hostCommands,
  hostProjects,
  hosts,
} from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, BadRequestError, ForbiddenError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  HostCommandController,
  HostController,
  HostInventoryService,
  LoreShipApi,
  ProjectHostController,
} from "../src/api/index.ts";
import { createTestHost } from "../src/testing/hosts.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

/**
 * The release this Lore installs, fixed: `alepha.meta` is baked in by a
 * build, and nothing built this spec.
 */
class FixedReleaseTarget extends BayReleaseTarget {
  public release: string | undefined = "0.40.0";

  override version(): string | undefined {
    return this.release;
  }
}

/**
 * The wire, recorded: every host is connected, and each frame pushed is kept.
 */
class RecordingTransport extends HostCommandTransport {
  public readonly pushed: HostCommandFrame[] = [];

  override async push(_host: Host, frame: HostServerFrame): Promise<boolean> {
    this.pushed.push(frame as HostCommandFrame);
    return true;
  }
}

class Repos {
  hosts = $repository(hosts);
  commands = $repository(hostCommands);
  grants = $repository(hostProjects);
}

interface TestContext {
  alepha: Alepha;
  api: HostCommandController;
  hostApi: HostController;
  lending: ProjectHostController;
  service: HostCommandService;
  inventories: HostInventoryService;
  transport: RecordingTransport;
  target: FixedReleaseTarget;
  repos: Repos;
  entities: DeployTestEntities;
  now: () => string;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  // Substituted BEFORE the module that registers the real ones.
  alepha.with({ provide: HostCommandTransport, use: RecordingTransport });
  alepha.with({ provide: BayReleaseTarget, use: FixedReleaseTarget });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repos);
  await alepha.start();
  const dateTime = alepha.inject(DateTimeProvider);

  return {
    alepha,
    api: alepha.inject(HostCommandController),
    hostApi: alepha.inject(HostController),
    lending: alepha.inject(ProjectHostController),
    service: alepha.inject(HostCommandService),
    inventories: alepha.inject(HostInventoryService),
    transport: alepha.inject(RecordingTransport),
    target: alepha.inject(FixedReleaseTarget),
    repos,
    entities,
    now: () => new Date(dateTime.nowMillis()).toISOString(),
  };
};

/**
 * A host of its owner's project: connected, accepting deploys, having
 * reported the Bay it runs and how it can be upgraded.
 */
const hostOf = async (
  ctx: TestContext,
  options: {
    bayVersion?: string;
    upgradeMode?: string;
    deployAllowed?: boolean;
    online?: boolean;
    reported?: boolean;
  } = {},
) => {
  const user = await ctx.entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const minted = await createTestHost(ctx.alepha, owner, { slug: "ovh-1" });
  await ctx.repos.hosts.updateById(minted.id, {
    deployAllowed: options.deployAllowed ?? true,
    ...(options.online === false
      ? {}
      : { connectedAt: ctx.now(), lastSeenAt: ctx.now() }),
  });
  const host = await ctx.repos.hosts.getOne({
    where: { id: { eq: minted.id } },
  });
  if (options.reported !== false) {
    await report(ctx, host, options.bayVersion ?? "0.39.0", {
      upgradeMode: "upgradeMode" in options ? options.upgradeMode : "handoff",
    });
  }
  return { owner, host, projectId: minted.projectId };
};

const report = (
  ctx: TestContext,
  host: Host,
  bayVersion: string | undefined,
  machine: { upgradeMode?: string } = { upgradeMode: "handoff" },
) =>
  ctx.inventories.record(host, {
    type: "inventory",
    at: ctx.now(),
    host: {
      ...(bayVersion === undefined ? {} : { bayVersion }),
      ...(machine.upgradeMode === undefined
        ? {}
        : { upgradeMode: machine.upgradeMode }),
    },
    apps: [],
  });

const upgrade = (
  ctx: TestContext,
  host: Host,
  user: UserAccountToken,
  version?: string,
) =>
  ctx.api.enqueueHostCommand(
    {
      params: { hostId: host.id },
      body: { kind: "upgrade", ...(version ? { version } : {}) },
    },
    { user },
  );

const rowsOf = (ctx: TestContext, host: Host) =>
  ctx.repos.commands.findMany({ where: { hostId: { eq: host.id } } });

describe("BayUpgrade, reading versions", () => {
  it("takes the x.y.z prefix of a git describe string as the release", ({
    expect,
  }) => {
    expect(BayUpgrade.targetOf("0.38.0")).toBe("0.38.0");
    expect(BayUpgrade.targetOf("0.38.0-12-g4ad66a8")).toBe("0.38.0");
    expect(BayUpgrade.targetOf("v0.38.0")).toBe("0.38.0");
  });

  it("offers nothing from a build with no release behind it", ({ expect }) => {
    for (const version of [
      "latest",
      "",
      undefined,
      "dev",
      "0.38",
      "0.38.0-rc.1",
      "deploy-12",
      "0.38.0-dirty",
    ]) {
      expect(BayUpgrade.targetOf(version)).toBeUndefined();
    }
  });

  it("compares versions as numbers, and refuses to compare anything else", ({
    expect,
  }) => {
    expect(BayUpgrade.compare("0.9.9", "0.10.0")).toBeLessThan(0);
    expect(BayUpgrade.compare("0.40.0", "0.39.12")).toBeGreaterThan(0);
    expect(BayUpgrade.compare("1.0.0", "1.0.0")).toBe(0);
    // The describe string would sort BELOW its own release under semver: it
    // is not a version here, so it is never compared as it stands.
    expect(BayUpgrade.compare("0.38.0-12-g4ad66a8", "0.38.0")).toBeUndefined();
    expect(BayUpgrade.compare("dev", "0.38.0")).toBeUndefined();
    expect(BayUpgrade.compare(undefined, "0.38.0")).toBeUndefined();
  });

  it("says a host is behind only when both versions are known", ({
    expect,
  }) => {
    const status = (
      bayVersion?: string,
      upgradeMode?: string,
      target?: string,
    ) => BayUpgrade.status({ bayVersion, upgradeMode, target });
    expect(status("0.39.0", "handoff", "0.40.0")).toEqual({
      upgradeAvailable: true,
      upgradeByHand: false,
    });
    for (const mode of [undefined, "restart", "manual", "something-new"]) {
      expect(status("0.39.0", mode, "0.40.0")).toEqual({
        upgradeAvailable: true,
        upgradeByHand: true,
      });
    }
    for (const [bayVersion, target] of [
      ["0.40.0", "0.40.0"],
      ["0.41.0", "0.40.0"],
      ["dev", "0.40.0"],
      [undefined, "0.40.0"],
      ["0.39.0", undefined],
    ] as const) {
      expect(status(bayVersion, undefined, target)).toEqual({
        upgradeAvailable: false,
        upgradeByHand: false,
      });
    }
  });

  it("writes the by-hand command with the drop-in switch", ({ expect }) => {
    expect(BayUpgrade.byHandCommand("0.40.0")).toBe(
      "curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=0.40.0 BAY_UPDATE_UNIT=yes sh",
    );
  });
});

describe("Upgrading a Bay host from Lore", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("sends the version this Lore installs, and nothing else about it", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);

    const command = await upgrade(ctx, host, owner);

    expect(command.kind).toBe("upgrade");
    expect(command.timeoutSeconds).toBe(300);
    // The row names both ends, for the host's activity.
    expect(command.payload).toEqual({
      app: "",
      environment: "",
      version: "0.40.0",
      fromVersion: "0.39.0",
    });
    // The frame is Bay's `command-upgrade.json`: a version, no instance, and
    // nothing of Lore's own.
    expect(ctx.transport.pushed).toEqual([
      {
        type: "command",
        id: command.id,
        kind: "upgrade",
        app: "",
        environment: "",
        version: "0.40.0",
      },
    ]);
  });

  it("sends a named version newer than the host's", async ({ expect }) => {
    const { owner, host } = await hostOf(ctx);
    const command = await upgrade(ctx, host, owner, "0.39.5");
    expect(command.payload.version).toBe("0.39.5");
  });

  it("refuses, before any row, a host whose deploys are off", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx, { deployAllowed: false });
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(ForbiddenError);
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(
      /does not accept deploys/,
    );
    expect(await rowsOf(ctx, host)).toEqual([]);
  });

  it("refuses an offline host instead of queueing for it", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx, { online: false });
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(BadRequestError);
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(
      /not connected right now/,
    );
    expect(await rowsOf(ctx, host)).toEqual([]);
  });

  it("refuses a host that never said which Bay it runs", async ({ expect }) => {
    const { owner, host } = await hostOf(ctx, { reported: false });
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(
      /has not reported which Bay it runs/,
    );
    expect(await rowsOf(ctx, host)).toEqual([]);
  });

  it("refuses a development Bay, whose version cannot be compared", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx, { bayVersion: "dev" });
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(
      /no release version \(dev\)/,
    );
    expect(await rowsOf(ctx, host)).toEqual([]);
  });

  it("refuses an older version: no downgrade from Lore", async ({ expect }) => {
    const { owner, host } = await hostOf(ctx);
    await expect(upgrade(ctx, host, owner, "0.38.0")).rejects.toThrow(
      ForbiddenError,
    );
    await expect(upgrade(ctx, host, owner, "0.38.0")).rejects.toThrow(
      /does not take a host back to 0\.38\.0.*install\.sh and BAY_VERSION=0\.38\.0/,
    );
    expect(await rowsOf(ctx, host)).toEqual([]);
  });

  it("refuses the version the host already runs", async ({ expect }) => {
    const { owner, host } = await hostOf(ctx, { bayVersion: "0.40.0" });
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(
      /already runs Bay 0\.40\.0/,
    );
  });

  it("refuses a host that is upgraded by hand, with the command to run", async ({
    expect,
  }) => {
    for (const [upgradeMode, why] of [
      [undefined, /too old to be upgraded from Lore/],
      ["restart", /lacks the handoff drop-in/],
      ["manual", /does not run under systemd/],
    ] as const) {
      const fresh = await setup();
      try {
        const { owner, host } = await hostOf(fresh, { upgradeMode });
        await expect(upgrade(fresh, host, owner)).rejects.toThrow(why);
        await expect(upgrade(fresh, host, owner)).rejects.toThrow(
          /sudo BAY_VERSION=0\.40\.0 BAY_UPDATE_UNIT=yes sh/,
        );
        expect(await rowsOf(fresh, host)).toEqual([]);
      } finally {
        await fresh.alepha.stop();
      }
    }
  });

  it("offers nothing on a Lore built from no release, unless a version is named", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    ctx.target.release = undefined;
    await expect(upgrade(ctx, host, owner)).rejects.toThrow(
      /not built from a release/,
    );
    const command = await upgrade(ctx, host, owner, "0.40.0");
    expect(command.payload.version).toBe("0.40.0");
  });

  it("refuses a version that is not a strict x.y.z at the door", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    for (const version of [
      "latest",
      "v0.40.0",
      "0.40",
      "0.40.0-rc.1",
      "0.40.0; rm -rf /",
    ]) {
      await expect(upgrade(ctx, host, owner, version)).rejects.toThrow();
    }
    expect(await rowsOf(ctx, host)).toEqual([]);
  });

  it("refuses a member of a project that only borrows the host", async ({
    expect,
  }) => {
    const { host } = await hostOf(ctx);
    const borrowerUser = await ctx.entities.users.create({});
    const borrower: UserAccountToken = { id: borrowerUser.id, roles: ["user"] };
    const other = await createTestProject(ctx.alepha, {
      createdBy: borrower.id,
    });
    await ctx.repos.grants.create({
      hostId: host.id,
      projectId: other.id,
      createdBy: host.ownerUserId,
    });
    await expect(upgrade(ctx, host, borrower)).rejects.toThrow();
    expect(await rowsOf(ctx, host)).toEqual([]);
  });

  it("keeps every other kind naming an environment, and an upgrade naming none", ({
    expect,
  }) => {
    const host = { type: "bay", slug: "ovh-1", deployAllowed: true } as Host;
    expect(() =>
      ctx.service.assertAccepts(host, "restart", {
        app: "demo",
        environment: "",
      }),
    ).toThrow(/names an environment/);
    expect(() =>
      ctx.service.assertAccepts(host, "upgrade", {
        app: "demo",
        environment: "production",
        version: "0.40.0",
      }),
    ).toThrow(/no app or environment/);
    expect(() =>
      ctx.service.assertAccepts(host, "upgrade", { app: "", environment: "" }),
    ).toThrow(/names a version/);
    expect(() =>
      ctx.service.assertAccepts(host, "upgrade", {
        app: "",
        environment: "",
        version: "0.40.0",
      }),
    ).not.toThrow();
  });
});

describe("How an upgrade settles", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const statusOf = async (id: string) =>
    ctx.repos.commands.getOne({ where: { id: { eq: id } } });

  const reconnect = async (host: Host): Promise<Host> => {
    // A second later than the command was sent, as a real reconnect is.
    const at = new Date(Date.parse(ctx.now()) + 1000).toISOString();
    await ctx.repos.hosts.updateById(host.id, {
      connectedAt: at,
      lastSeenAt: at,
    });
    return ctx.repos.hosts.getOne({ where: { id: { eq: host.id } } });
  };

  it("is done on the old Bay's ack, the normal path", async ({ expect }) => {
    const { owner, host } = await hostOf(ctx);
    const command = await upgrade(ctx, host, owner);
    await ctx.service.ack(host.id, {
      id: command.id,
      status: "running",
      step: "handing over",
    });
    await ctx.service.ack(host.id, { id: command.id, status: "done" });
    expect((await statusOf(command.id)).status).toBe("done");
  });

  it("carries the reason of a Bay that refused or rolled back", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    const command = await upgrade(ctx, host, owner);
    await ctx.service.ack(host.id, {
      id: command.id,
      status: "failed",
      step: "handing over",
      reason: "0.40.0 did not take over, so this Bay keeps serving 0.39.0",
    });
    const row = await statusOf(command.id);
    expect(row.status).toBe("failed");
    expect(row.reason).toMatch(/keeps serving 0\.39\.0/);
  });

  it("is done from the inventory when the ack was lost and the host runs the version asked", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    const command = await upgrade(ctx, host, owner);
    await ctx.service.ack(host.id, { id: command.id, status: "running" });

    await ctx.service.settleUpgrades(await reconnect(host), "0.40.0");

    const row = await statusOf(command.id);
    expect(row.status).toBe("done");
    expect(row.finishedAt).toBeDefined();
  });

  it("fails from the inventory when the host came back on another version", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    const command = await upgrade(ctx, host, owner);
    await ctx.service.ack(host.id, { id: command.id, status: "running" });

    await ctx.service.settleUpgrades(await reconnect(host), "0.39.0");

    const row = await statusOf(command.id);
    expect(row.status).toBe("failed");
    expect(row.reason).toBe("The host came back on Bay 0.39.0, not 0.40.0");
  });

  it("leaves a running upgrade alone while the old Bay is still the one reporting", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    const command = await upgrade(ctx, host, owner);
    await ctx.service.ack(host.id, {
      id: command.id,
      status: "running",
      step: "downloading",
    });

    // Same connection as when the command was sent: the old process, mid
    // download, pushing its periodic inventory.
    await ctx.service.settleUpgrades(host, "0.39.0");

    expect((await statusOf(command.id)).status).toBe("running");
  });

  it("touches no other command, and none that already ended", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    const restart = await ctx.api.enqueueHostCommand(
      {
        params: { hostId: host.id },
        body: { kind: "restart", app: "demo", environment: "production" },
      },
      { user: owner },
    );
    const failed = await upgrade(ctx, host, owner);
    await ctx.service.ack(host.id, {
      id: failed.id,
      status: "failed",
      reason: "checksum mismatch",
    });

    await ctx.service.settleUpgrades(await reconnect(host), "0.40.0");

    expect((await statusOf(restart.id)).status).toBe("sent");
    const row = await statusOf(failed.id);
    expect(row.status).toBe("failed");
    expect(row.reason).toBe("checksum mismatch");
  });

  it("is read from the inventory by the sweep before it calls a timeout", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    const reached = await upgrade(ctx, host, owner);
    await ctx.service.ack(host.id, { id: reached.id, status: "running" });
    await report(ctx, host, "0.40.0");
    const later = Date.parse(ctx.now()) + 301_000;

    expect(await ctx.service.sweep(later)).toBe(0);
    expect((await statusOf(reached.id)).status).toBe("done");

    // And one the host never reached is failed, saying what it reports.
    const missed = await upgrade(ctx, host, owner, "0.41.0");
    await ctx.service.ack(host.id, { id: missed.id, status: "running" });
    expect(await ctx.service.sweep(Date.parse(ctx.now()) + 301_000)).toBe(1);
    const row = await statusOf(missed.id);
    expect(row.status).toBe("failed");
    expect(row.reason).toBe(
      "Timed out after 300 seconds; the host reports Bay 0.40.0",
    );
  });
});

describe("What Lore says about a host's Bay version", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const inventoryOf = async (host: Host, user: UserAccountToken) =>
    (
      await ctx.hostApi.getHostInventory(
        { params: { hostId: host.id } },
        { user },
      )
    ).inventory;

  it("names the target, and says a host in handoff mode can be upgraded", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx);
    expect(await inventoryOf(host, owner)).toMatchObject({
      bayVersion: "0.39.0",
      upgradeMode: "handoff",
      targetBayVersion: "0.40.0",
      upgradeAvailable: true,
      upgradeByHand: false,
    });
  });

  it("says by hand for a Bay too old to report a mode, with no drop-in, or outside systemd", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx, { upgradeMode: undefined });
    const old = await inventoryOf(host, owner);
    expect(old).toMatchObject({ upgradeAvailable: true, upgradeByHand: true });
    expect(old?.upgradeMode).toBeUndefined();

    for (const upgradeMode of ["restart", "manual"]) {
      await report(ctx, host, "0.39.0", { upgradeMode });
      expect(await inventoryOf(host, owner)).toMatchObject({
        upgradeMode,
        upgradeAvailable: true,
        upgradeByHand: true,
      });
    }
  });

  it("offers nothing to a host that is current, ahead, or on a development build", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf(ctx, { bayVersion: "0.40.0" });
    for (const bayVersion of ["0.40.0", "0.41.0", "dev"]) {
      await report(ctx, host, bayVersion);
      expect(await inventoryOf(host, owner)).toMatchObject({
        bayVersion,
        upgradeAvailable: false,
        upgradeByHand: false,
      });
    }
  });

  it("names no target on a Lore built from no release", async ({ expect }) => {
    const { owner, host } = await hostOf(ctx);
    ctx.target.release = undefined;
    const inventory = await inventoryOf(host, owner);
    expect(inventory?.targetBayVersion).toBeUndefined();
    expect(inventory).toMatchObject({
      upgradeAvailable: false,
      upgradeByHand: false,
    });
  });

  it("puts the version and whether one is due on the host list, with one read", async ({
    expect,
  }) => {
    const { owner, host, projectId } = await hostOf(ctx);
    const list = async () =>
      (
        await ctx.lending.listProjectHosts(
          { params: { projectId } },
          { user: owner },
        )
      ).items;

    expect(await list()).toMatchObject([
      {
        slug: "ovh-1",
        bayVersion: "0.39.0",
        upgradeAvailable: true,
        targetBayVersion: "0.40.0",
      },
    ]);

    await report(ctx, host, "0.40.0");
    const [current] = await list();
    expect(current).toMatchObject({
      bayVersion: "0.40.0",
      upgradeAvailable: false,
    });
    expect(current?.targetBayVersion).toBeUndefined();
  });

  it("says nothing of a version for a host that never reported", async ({
    expect,
  }) => {
    const { owner, projectId } = await hostOf(ctx, { reported: false });
    const [silent] = (
      await ctx.lending.listProjectHosts(
        { params: { projectId } },
        { user: owner },
      )
    ).items;
    expect(silent?.bayVersion).toBeUndefined();
    expect(silent?.upgradeAvailable).toBe(false);
  });
});
