import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { TestEntityRepositories } from "../../../test/fixtures/entities.ts";
import { EstateController } from "../controllers/EstateController.ts";
import { estateCommands } from "../entities/estateCommands.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import type { EstateCommandFrame } from "../schemas/estateCommandFrameSchema.ts";
import { EstateCommandService } from "./EstateCommandService.ts";
import { EstateCommandTransport } from "./EstateCommandTransport.ts";

/**
 * The wire, faked: records every push and answers "connected" only for the
 * estates a test says are. What the queue does with a live socket, a dead
 * one and a reconnect is the whole subject, so the transport is the one seam
 * substituted here, and nothing else is.
 */
class MemoryEstateCommandTransport extends EstateCommandTransport {
  public readonly connected = new Set<string>();
  public readonly pushed: Array<{
    estateId: string;
    frame: EstateCommandFrame;
  }> = [];

  override async push(
    estateId: string,
    frame: EstateCommandFrame,
  ): Promise<boolean> {
    this.pushed.push({ estateId, frame });
    return this.connected.has(estateId);
  }
}

class EstateRepositories {
  estates = $repository(estates);
  commands = $repository(estateCommands);
}

interface TestContext {
  alepha: Alepha;
  service: EstateCommandService;
  transport: MemoryEstateCommandTransport;
  estateApi: EstateController;
  repos: EstateRepositories;
  entities: TestEntityRepositories;
  now: () => number;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  // Substituted BEFORE the module that registers the real one: a
  // substitution declared after the service is in use is refused.
  alepha.with({
    provide: EstateCommandTransport,
    use: MemoryEstateCommandTransport,
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(EstateRepositories);

  await alepha.start();

  const dateTime = alepha.inject(DateTimeProvider);
  return {
    alepha,
    service: alepha.inject(EstateCommandService),
    transport: alepha.inject(MemoryEstateCommandTransport),
    estateApi: alepha.inject(EstateController),
    repos,
    entities,
    now: () => dateTime.nowMillis(),
  };
};

const createOwner = async (ctx: TestContext): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({});
  return { id: user.id, roles: ["user"] };
};

/**
 * An estate row straight from the repository, so a test can hold the row
 * (with its switches) rather than the masked resource.
 */
const createEstate = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
): Promise<Estate> => {
  const minted = await ctx.estateApi.createEstate({ body: { slug } }, { user });
  return ctx.repos.estates.getOne({ where: { id: { eq: minted.id } } });
};

const restart = {
  kind: "restart" as const,
  payload: { app: "lore", environment: "production" },
};

const MINUTE = 60_000;

describe("EstateCommandService, enqueue and push", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("pushes the instant it is queued when the machine is connected, and holds it otherwise", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const online = await createEstate(ctx, owner, "online");
    const offline = await createEstate(ctx, owner, "offline");
    ctx.transport.connected.add(online.id);

    const sent = await ctx.service.enqueue(online, restart, owner.id);
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeDefined();
    expect(sent.timeoutSeconds).toBe(120);
    expect(ctx.transport.pushed.at(-1)?.frame).toEqual({
      type: "command",
      id: sent.id,
      kind: "restart",
      app: "lore",
      environment: "production",
    });

    const held = await ctx.service.enqueue(offline, restart, owner.id);
    expect(held.status).toBe("pending");
    expect(held.sentAt).toBeUndefined();
  });

  it("refuses a deploy while the estate does not allow them, and accepts once it does", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const estate = await createEstate(ctx, owner, "ovh-1");
    const deploy = {
      kind: "deploy" as const,
      payload: {
        app: "lore",
        environment: "production",
        artifact: { id: crypto.randomUUID(), sha256: "a".repeat(64), size: 10 },
      },
    };

    await expect(ctx.service.enqueue(estate, deploy, owner.id)).rejects.toThrow(
      ForbiddenError,
    );

    await ctx.estateApi.updateEstate(
      { params: { estateId: estate.id }, body: { deployAllowed: true } },
      { user: owner },
    );
    const allowed = await ctx.repos.estates.getOne({
      where: { id: { eq: estate.id } },
    });
    const queued = await ctx.service.enqueue(allowed, deploy, owner.id);
    expect(queued.kind).toBe("deploy");
    expect(queued.timeoutSeconds).toBe(900);
    expect(ctx.service.frameOf(queued).artifact).toEqual(
      deploy.payload.artifact,
    );
  });

  it("reconciles on connect under the same ids, and again while still unacknowledged", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const estate = await createEstate(ctx, owner, "ovh-1");

    const first = await ctx.service.enqueue(estate, restart, owner.id);
    const second = await ctx.service.enqueue(estate, restart, owner.id);
    expect([first.status, second.status]).toEqual(["pending", "pending"]);

    // The machine connects: both go out, oldest first, under their own ids.
    ctx.transport.connected.add(estate.id);
    expect(await ctx.service.reconcile(estate.id)).toBe(2);
    const afterFirst = await ctx.repos.commands.findMany({
      where: { estateId: { eq: estate.id } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    expect(afterFirst.map((row) => [row.id, row.status])).toEqual([
      [first.id, "sent"],
      [second.id, "sent"],
    ]);

    // A reconnect before any ack pushes the same two again: sent means the
    // push landed on a socket, not that the machine read it.
    ctx.transport.pushed.length = 0;
    expect(await ctx.service.reconcile(estate.id)).toBe(2);
    expect(ctx.transport.pushed.map((push) => push.frame.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(
      await ctx.repos.commands.count({ estateId: { eq: estate.id } }),
    ).toBe(2);
  });
});

describe("EstateCommandService, acknowledgements", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("records running, then a terminal outcome, and ignores an echo", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const estate = await createEstate(ctx, owner, "ovh-1");
    ctx.transport.connected.add(estate.id);
    const command = await ctx.service.enqueue(estate, restart, owner.id);

    const running = await ctx.service.ack(estate.id, {
      id: command.id,
      status: "running",
      step: "stopping",
    });
    expect(running?.status).toBe("running");
    expect(running?.runningAt).toBeDefined();
    expect(running?.step).toBe("stopping");

    const done = await ctx.service.ack(estate.id, {
      id: command.id,
      status: "done",
    });
    expect(done?.status).toBe("done");
    expect(done?.finishedAt).toBeDefined();

    // Redelivery is normal: a second terminal ack changes nothing.
    const echo = await ctx.service.ack(estate.id, {
      id: command.id,
      status: "failed",
      reason: "late",
    });
    expect(echo?.status).toBe("done");
    expect(echo?.reason).toBeUndefined();
  });

  it("keeps a failure's reason, and ignores an ack from an estate that does not hold the command", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const mine = await createEstate(ctx, owner, "mine");
    const other = await createEstate(ctx, owner, "other");
    const command = await ctx.service.enqueue(mine, restart, owner.id);

    expect(
      await ctx.service.ack(other.id, { id: command.id, status: "done" }),
    ).toBeUndefined();
    const untouched = await ctx.repos.commands.getOne({
      where: { id: { eq: command.id } },
    });
    expect(untouched.status).toBe("pending");

    const failed = await ctx.service.ack(mine.id, {
      id: command.id,
      status: "failed",
      reason: "unknown instance lore/production",
    });
    expect(failed?.status).toBe("failed");
    expect(failed?.reason).toBe("unknown instance lore/production");
  });
});

describe("EstateCommandService, the sweep", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("fails what waited too long, with a reason, and leaves the rest alone", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const offline = await createEstate(ctx, owner, "offline");
    const online = await createEstate(ctx, owner, "online");
    ctx.transport.connected.add(online.id);

    const neverFetched = await ctx.service.enqueue(offline, restart, owner.id);
    const neverAcked = await ctx.service.enqueue(online, restart, owner.id);
    const slowRestart = await ctx.service.enqueue(online, restart, owner.id);
    await ctx.service.ack(online.id, { id: slowRestart.id, status: "running" });
    await ctx.estateApi.updateEstate(
      { params: { estateId: online.id }, body: { deployAllowed: true } },
      { user: owner },
    );
    const allowed = await ctx.repos.estates.getOne({
      where: { id: { eq: online.id } },
    });
    const slowDeploy = await ctx.service.enqueue(
      allowed,
      {
        kind: "deploy",
        payload: {
          app: "lore",
          environment: "production",
          artifact: {
            id: crypto.randomUUID(),
            sha256: "b".repeat(64),
            size: 1,
          },
        },
      },
      owner.id,
    );
    await ctx.service.ack(online.id, { id: slowDeploy.id, status: "running" });

    // Nothing is late yet.
    expect(await ctx.service.sweep(ctx.now() + MINUTE)).toBe(0);

    // Three minutes on: the unacknowledged push and the restart are late, the
    // deploy (fifteen minutes) is not, and the pending one has a day.
    expect(await ctx.service.sweep(ctx.now() + 3 * MINUTE)).toBe(2);
    const byId = async (id: string) =>
      ctx.repos.commands.getOne({ where: { id: { eq: id } } });
    expect((await byId(neverAcked.id)).status).toBe("failed");
    expect((await byId(neverAcked.id)).reason).toBe(
      "Never acknowledged by the estate",
    );
    expect((await byId(slowRestart.id)).reason).toBe(
      "Timed out after 120 seconds",
    );
    expect((await byId(slowDeploy.id)).status).toBe("running");
    expect((await byId(neverFetched.id)).status).toBe("pending");

    // A day on: everything else too.
    expect(await ctx.service.sweep(ctx.now() + 25 * 60 * MINUTE)).toBe(2);
    expect((await byId(neverFetched.id)).reason).toBe(
      "The estate never connected to receive it",
    );
    expect((await byId(slowDeploy.id)).reason).toBe(
      "Timed out after 900 seconds",
    );
  });

  it("prunes terminal rows beyond the cap per estate, never an open one", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const estate = await createEstate(ctx, owner, "ovh-1");
    ctx.transport.connected.add(estate.id);

    const commands = [];
    for (let i = 0; i < 5; i += 1) {
      commands.push(await ctx.service.enqueue(estate, restart, owner.id));
    }
    // The first four finish; the fifth is still out there.
    for (const command of commands.slice(0, 4)) {
      await ctx.service.ack(estate.id, { id: command.id, status: "done" });
    }

    expect(await ctx.service.prune(2)).toBe(2);

    const left = await ctx.service.listFor(estate.id);
    expect(left.map((row) => row.id)).toEqual([
      commands[4].id,
      commands[3].id,
      commands[2].id,
    ]);
  });
});
