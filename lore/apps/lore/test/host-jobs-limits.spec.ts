import {
  HostCommandController,
  HostCommandService,
  HostCommandTransport,
  HostInventoryService,
} from "@lore/core/api";
import {
  type Host,
  type HostCommandFrame,
  type HostServerFrame,
  hostCommands,
  hostProjects,
  hosts,
} from "@lore/core/schemas";
import { createTestProject } from "@lore/core/testing";
import { createTestHost } from "@lore/core/testing/hosts";
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, BadRequestError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

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

/**
 * An Agent host's two lane widths, set from Lore (#Q4543): the route sends
 * Bay the `jobs-limits` command within the bounds of `bay config jobs`, and
 * Lore keeps no copy, so the host's columns move only with the inventory.
 */
describe("Setting an Agent host's job limits from Lore", () => {
  let alepha: Alepha;
  let api: HostCommandController;
  let inventories: HostInventoryService;
  let service: HostCommandService;
  let transport: RecordingTransport;
  let repos: Repos;
  let entities: DeployTestEntities;
  let now: () => string;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with({ provide: HostCommandTransport, use: RecordingTransport });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreShipApi);
    entities = alepha.inject(DeployTestEntities);
    repos = alepha.inject(Repos);
    await alepha.start();
    const dateTime = alepha.inject(DateTimeProvider);
    now = () => new Date(dateTime.nowMillis()).toISOString();
    api = alepha.inject(HostCommandController);
    inventories = alepha.inject(HostInventoryService);
    service = alepha.inject(HostCommandService);
    transport = alepha.inject(RecordingTransport);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const hostOf = async (options: { online?: boolean } = {}) => {
    const user = await entities.users.create({});
    const owner: UserAccountToken = { id: user.id, roles: ["user"] };
    const minted = await createTestHost(alepha, owner, { slug: "box-1" });
    await repos.hosts.updateById(minted.id, {
      jobsAllowed: true,
      agentHost: true,
      ...(options.online === false
        ? {}
        : { connectedAt: now(), lastSeenAt: now() }),
    });
    const host = await repos.hosts.getOne({ where: { id: { eq: minted.id } } });
    return { owner, host };
  };

  const send = (
    host: Host,
    user: UserAccountToken,
    body: { maxJobs?: number; maxReadJobs?: number },
  ) =>
    api.enqueueHostCommand(
      { params: { hostId: host.id }, body: { kind: "jobs-limits", ...body } },
      { user },
    );

  const rowsOf = (host: Host) =>
    repos.commands.findMany({ where: { hostId: { eq: host.id } } });

  it("sends both widths, and nothing about an app, and changes no column of the host", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf();
    const command = await send(host, owner, { maxJobs: 2, maxReadJobs: 6 });
    expect(command.kind).toBe("jobs-limits");
    const frame = transport.pushed.at(-1);
    expect(frame).toEqual({
      type: "command",
      id: command.id,
      kind: "jobs-limits",
      app: "",
      environment: "",
      maxJobs: 2,
      maxReadJobs: 6,
    });
    // Lore keeps no copy: the columns wait for the host's inventory.
    const after = await repos.hosts.getOne({ where: { id: { eq: host.id } } });
    expect(after.jobsMaxJobs ?? null).toBeNull();
    expect(after.jobsMaxReadJobs ?? null).toBeNull();
    await inventories.record(after, {
      type: "inventory",
      at: now(),
      host: {},
      apps: [],
      jobs: { user: "bay-agent", running: "", maxJobs: 2, maxReadJobs: 6 },
    });
    const reported = await repos.hosts.getOne({
      where: { id: { eq: host.id } },
    });
    expect(reported.jobsMaxJobs).toBe(2);
    expect(reported.jobsMaxReadJobs).toBe(6);
  });

  it("sends one width alone, leaving the other to the machine", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf();
    await send(host, owner, { maxReadJobs: 3 });
    const frame = transport.pushed.at(-1);
    expect(frame?.maxReadJobs).toBe(3);
    expect(frame && "maxJobs" in frame).toBe(false);
  });

  it("refuses a width out of 1 to 16, or none, before any row", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf();
    for (const body of [
      { maxJobs: 0 },
      { maxJobs: 17 },
      { maxReadJobs: -1 },
      { maxJobs: 1.5 },
      {},
    ]) {
      const refused = await send(host, owner, body).then(
        () => undefined,
        (error: { status?: number }) => error,
      );
      expect(refused?.status).toBe(400);
    }
    expect(await rowsOf(host)).toEqual([]);
  });

  it("refuses a host that is not connected instead of queueing for it", async ({
    expect,
  }) => {
    const { owner, host } = await hostOf({ online: false });
    await expect(send(host, owner, { maxJobs: 2 })).rejects.toThrow(
      BadRequestError,
    );
    await expect(send(host, owner, { maxJobs: 2 })).rejects.toThrow(
      /not connected right now/,
    );
    expect(await rowsOf(host)).toEqual([]);
  });

  it("refuses a member of a project that only borrows the host", async ({
    expect,
  }) => {
    const { host } = await hostOf();
    const borrowerUser = await entities.users.create({});
    const borrower: UserAccountToken = { id: borrowerUser.id, roles: ["user"] };
    const other = await createTestProject(alepha, { createdBy: borrower.id });
    await repos.grants.create({
      hostId: host.id,
      projectId: other.id,
      createdBy: host.ownerUserId,
    });
    await expect(send(host, borrower, { maxJobs: 2 })).rejects.toThrow();
    expect(await rowsOf(host)).toEqual([]);
  });

  it("refuses a jobs-limits that names an app, or no width, at the service", ({
    expect,
  }) => {
    const host = { type: "bay", slug: "box-1" } as Host;
    expect(() =>
      service.assertAccepts(host, "jobs-limits", {
        app: "shop",
        environment: "",
        maxJobs: 2,
      }),
    ).toThrow(BadRequestError);
    expect(() =>
      service.assertAccepts(host, "jobs-limits", { app: "", environment: "" }),
    ).toThrow(BadRequestError);
  });
});
