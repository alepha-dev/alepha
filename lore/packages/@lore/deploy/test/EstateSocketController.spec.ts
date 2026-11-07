import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import WebSocket from "ws";

import { LoreDeployApi } from "../src/api/index.ts";
import {
  EstateCommandService,
  EstateCommandTransport,
  EstateService,
  EstateStatsService,
  WebSocketEstateCommandTransport,
  EstateController,
  EstateEventService,
  EstateSocketController,
} from "../src/api/index.ts";
import {
  estateCommands,
  type Estate,
  estates,
  type EstateStatsFrame,
} from "../src/schemas/index.ts";
import { DeployTestEntities } from "../src/testing/index.ts";

/**
 * Records what the endpoint hands over, so the split between "the
 * connection" (this controller) and "what a measurement is" (#1627) can be
 * asserted from the outside.
 */
class RecordingStatsService extends EstateStatsService {
  public readonly frames: Array<{ estateId: string; frame: EstateStatsFrame }> =
    [];

  override async record(estate: Estate, frame: EstateStatsFrame) {
    this.frames.push({ estateId: estate.id, frame });
  }
}

/**
 * The controller with a gate on its estate read: `holdNext()` parks the next
 * read until `release()`, so a spec can land another socket's write inside
 * the window a read-then-write would leave open. The fixed controller does
 * no such read on connect or close, so a gate that is never hit is the
 * point, not a failure.
 */
class GatedEstateSocketController extends EstateSocketController {
  public hit = false;
  protected held?: Promise<void>;
  protected open?: () => void;

  public holdNext(): void {
    this.hit = false;
    this.held = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  public release(): void {
    this.held = undefined;
    this.open?.();
    this.open = undefined;
  }

  protected override async estateOf(id: string | undefined) {
    const estate = await super.estateOf(id);
    const held = this.held;
    if (held) {
      this.held = undefined;
      this.hit = true;
      await held;
    }
    return estate;
  }
}

class EstateRepositories {
  estates = $repository(estates);
  commands = $repository(estateCommands);
}

interface TestContext {
  alepha: Alepha;
  estateApi: EstateController;
  commands: EstateCommandService;
  service: EstateService;
  stats: RecordingStatsService;
  repos: EstateRepositories;
  gate: GatedEstateSocketController;
  entities: DeployTestEntities;
  url: string;
}

/**
 * A client socket plus every frame it has received, parsed.
 */
interface Client {
  ws: WebSocket;
  frames: Array<Record<string, unknown>>;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  // Both substitutions BEFORE the modules that register the originals.
  alepha.with({
    provide: EstateCommandTransport,
    use: WebSocketEstateCommandTransport,
  });
  alepha.with({ provide: EstateStatsService, use: RecordingStatsService });
  alepha.with({
    provide: EstateSocketController,
    use: GatedEstateSocketController,
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreDeployApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(EstateRepositories);

  await alepha.start();

  return {
    alepha,
    estateApi: alepha.inject(EstateController),
    commands: alepha.inject(EstateCommandService),
    service: alepha.inject(EstateService),
    stats: alepha.inject(RecordingStatsService),
    repos,
    gate: alepha.inject(GatedEstateSocketController),
    entities,
    url:
      alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://") + EstateSocketController.PATH,
  };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until `predicate` holds, or fails after two seconds: a socket frame
 * arrives whenever it arrives, and a fixed sleep is either too long or wrong.
 */
const waitFor = async (predicate: () => boolean, what: string) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await delay(20);
  }
};

/**
 * An ack is processed after the socket frame lands, so the row is what to
 * wait on, not the send.
 */
const waitForStatus = async (ctx: TestContext, id: string, status: string) => {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const row = await ctx.repos.commands.getOne({ where: { id: { eq: id } } });
    if (row.status === status) return row;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the command to be ${status}`);
    }
    await delay(20);
  }
};

const createOwner = async (ctx: TestContext): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({});
  return { id: user.id, roles: ["user"] };
};

const mint = async (
  ctx: TestContext,
  owner: UserAccountToken,
  slug: string,
) => {
  const minted = await ctx.estateApi.createEstate(
    { body: { slug } },
    { user: owner },
  );
  // A bay create always mints. The response type allows an absent secret
  // because a cloudflare create mints nothing (#1629), and this whole spec
  // is about the machine that dials in with one.
  return { ...minted, secret: minted.secret! };
};

const rowOf = (ctx: TestContext, id: string) =>
  ctx.repos.estates.getOne({ where: { id: { eq: id } } });

const connect = (
  ctx: TestContext,
  secret: string,
  extra: Record<string, string> = {},
): Promise<Client> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(ctx.url, {
      headers: { authorization: `Bearer ${secret}`, ...extra },
    });
    const client: Client = { ws, frames: [] };
    ws.on("message", (data: Buffer) => {
      client.frames.push(JSON.parse(data.toString("utf8")));
    });
    ws.on("open", () => resolve(client));
    ws.on("unexpected-response", (_req, res) =>
      reject(new Error(`refused ${res.statusCode}`)),
    );
    ws.on("error", reject);
  });

const refusal = (ctx: TestContext, secret: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(ctx.url, {
      headers: { authorization: `Bearer ${secret}` },
    });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => reject(new Error("accepted a secret it must refuse")));
  });

const send = (client: Client, frame: Record<string, unknown>) =>
  client.ws.send(JSON.stringify(frame));

const hello = async (client: Client) => {
  send(client, { type: "hello" });
  await waitFor(
    () => client.frames.some((frame) => frame.type === "welcome"),
    "the welcome frame",
  );
};

const close = async (client: Client) => {
  const closed = new Promise<void>((resolve) =>
    client.ws.on("close", () => resolve()),
  );
  client.ws.close();
  await closed;
  // The server's own close handler runs after the client sees the close.
  await delay(100);
};

describe("EstateSocketController, the handshake", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers hello with welcome, and stamps the row connected", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");

    const client = await connect(ctx, minted.secret);
    await hello(client);

    expect(client.frames[0]).toMatchObject({
      type: "welcome",
      protocol: 1,
      estate: { id: minted.id, slug: "ovh-1" },
      deployAllowed: false,
      statsIntervalSeconds: 1800,
    });

    const row = await rowOf(ctx, minted.id);
    expect(row.connectedAt).toBeDefined();
    expect(row.connectionId).toBeDefined();
    expect(ctx.service.isOnline(row)).toBe(true);

    await close(client);
  });

  it("records the address the machine connects from (#Q3137)", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-ip");

    const client = await connect(ctx, minted.secret);
    await hello(client);
    // On Node the engine reports the socket's own address: loopback here.
    expect((await rowOf(ctx, minted.id)).publicIp).toMatch(
      /^(127\.0\.0\.1|::1)$/,
    );
    await close(client);
  });

  it("refuses a bad secret and a rotated one with 401, before any socket exists", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");

    expect(await refusal(ctx, "est_nope")).toBe(401);

    const rotated = await ctx.estateApi.rotateEstate(
      { params: { estateId: minted.id } },
      { user: owner },
    );
    expect(await refusal(ctx, minted.secret)).toBe(401);

    const client = await connect(ctx, rotated.secret!);
    await close(client);
  });
});

describe("EstateSocketController, commands", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const restart = {
    kind: "restart" as const,
    payload: { app: "lore", environment: "production" },
  };

  it("delivers what was queued while offline, on hello, under the same ids", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const estate = await rowOf(ctx, minted.id);
    const first = await ctx.commands.enqueue(estate, restart, owner.id);
    const second = await ctx.commands.enqueue(estate, restart, owner.id);
    expect([first.status, second.status]).toEqual(["pending", "pending"]);

    const client = await connect(ctx, minted.secret);
    await hello(client);
    await waitFor(
      () =>
        client.frames.filter((frame) => frame.type === "command").length === 2,
      "the two queued commands",
    );

    const delivered = client.frames.filter((frame) => frame.type === "command");
    expect(delivered.map((frame) => frame.id)).toEqual([first.id, second.id]);
    expect(delivered[0]).toMatchObject({
      type: "command",
      kind: "restart",
      app: "lore",
      environment: "production",
    });
    const rows = await ctx.commands.pendingFor(estate.id);
    expect(rows.map((row) => row.status)).toEqual(["sent", "sent"]);

    await close(client);
  });

  it("pushes a command the instant it is queued while connected, and records the acks", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const client = await connect(ctx, minted.secret);
    await hello(client);

    const queued = await ctx.commands.enqueue(
      await rowOf(ctx, minted.id),
      restart,
      owner.id,
    );
    expect(queued.status).toBe("sent");
    await waitFor(
      () => client.frames.some((frame) => frame.id === queued.id),
      "the pushed command",
    );

    send(client, {
      type: "ack",
      id: queued.id,
      status: "running",
      step: "stopping",
    });
    await waitForStatus(ctx, queued.id, "running");
    send(client, { type: "ack", id: queued.id, status: "done" });
    const row = await waitForStatus(ctx, queued.id, "done");
    expect(row.status).toBe("done");
    expect(row.step).toBe("stopping");
    expect(row.runningAt).toBeDefined();
    expect(row.finishedAt).toBeDefined();

    await close(client);
  });

  it("pushes a config frame the moment a switch the machine acts on changes", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const client = await connect(ctx, minted.secret);
    await hello(client);

    await ctx.estateApi.updateEstate(
      {
        params: { estateId: minted.id },
        body: { deployAllowed: true, statsIntervalSeconds: 300 },
      },
      { user: owner },
    );
    await waitFor(
      () => client.frames.some((frame) => frame.type === "config"),
      "the config frame",
    );

    expect(
      client.frames.find((frame) => frame.type === "config"),
    ).toMatchObject({
      type: "config",
      deployAllowed: true,
      statsIntervalSeconds: 300,
    });

    await close(client);
  });
});

describe("EstateSocketController, liveness", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("stamps lastSeenAt on every frame and hands stats to the stats service", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const client = await connect(ctx, minted.secret);
    await hello(client);
    const before = (await rowOf(ctx, minted.id)).lastSeenAt;

    await delay(20);
    send(client, {
      type: "stats",
      cpuPercent: 34.5,
      memoryPercent: 61,
      at: new Date().toISOString(),
    });
    await waitFor(() => ctx.stats.frames.length === 1, "the stats hand-over");

    expect(ctx.stats.frames[0]).toMatchObject({
      estateId: minted.id,
      frame: { type: "stats", cpuPercent: 34.5, memoryPercent: 61 },
    });
    const after = (await rowOf(ctx, minted.id)).lastSeenAt;
    expect(after).toBeDefined();
    expect(after! >= before!).toBe(true);

    await close(client);
  });

  it("stamps disconnectedAt on close, unless an older socket's goodbye arrives after a reconnect", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");

    const first = await connect(ctx, minted.secret);
    await hello(first);
    const second = await connect(ctx, minted.secret);
    await hello(second);

    // The first socket says goodbye after the second took over: ignored.
    await close(first);
    expect(ctx.service.isOnline(await rowOf(ctx, minted.id))).toBe(true);

    // The socket that holds the row says goodbye: offline.
    await close(second);
    const row = await rowOf(ctx, minted.id);
    expect(row.disconnectedAt).toBeDefined();
    expect(ctx.service.isOnline(row)).toBe(false);
  });
});

/**
 * Bay's backup events: offered in the welcome, kept once per id (Bay
 * replays its unacknowledged events after a reconnect), and listed per app
 * with the estate-wide ones (an app-less event, a bucket down, concerns
 * every app on the machine).
 */
describe("EstateSocketController, events", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    type: "event",
    id,
    kind: "backup.completed",
    at: new Date().toISOString(),
    app: "lore",
    env: "production",
    data: { key: "lore/production/k.tar.zst", bytes: 1024 },
    ...extra,
  });

  it("offers events in the welcome and keeps each id once", async ({
    expect,
  }) => {
    const events = ctx.alepha.inject(EstateEventService);
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-events");
    const client = await connect(ctx, minted.secret);
    await hello(client);

    const welcome = client.frames.find((frame) => frame.type === "welcome");
    expect(welcome?.features).toEqual(["events"]);

    send(client, event("evt-1"));
    send(client, event("evt-1"));
    send(client, event("evt-2", { app: "other" }));
    send(
      client,
      event("evt-3", { kind: "target.down", app: undefined, env: undefined }),
    );
    let rows: Awaited<ReturnType<EstateEventService["list"]>> = [];
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      rows = await events.list(minted.id, { limit: 200 });
      if (rows.length >= 3) break;
      await delay(20);
    }
    await delay(100);
    rows = await events.list(minted.id, { limit: 200 });
    expect(rows.map((row) => row.eventId).sort()).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
    ]);
    expect(rows.find((row) => row.eventId === "evt-1")?.data).toEqual({
      key: "lore/production/k.tar.zst",
      bytes: 1024,
    });

    const forLore = await events.list(minted.id, {
      app: "lore",
      env: "production",
    });
    expect(forLore.map((row) => row.eventId).sort()).toEqual([
      "evt-1",
      "evt-3",
    ]);

    await close(client);
  });

  it("keeps one of two deliveries of an event that race each other", async ({
    expect,
  }) => {
    const events = ctx.alepha.inject(EstateEventService);
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-events-race");
    const estate = await rowOf(ctx, minted.id);
    const frame = {
      type: "event" as const,
      id: "evt-race",
      kind: "backup.completed",
      at: new Date().toISOString(),
    };

    const kept = await Promise.all([
      events.record(estate, frame),
      events.record(estate, frame),
    ]);
    expect(kept.filter(Boolean)).toHaveLength(1);
    expect(await events.list(minted.id)).toHaveLength(1);
  });

  it("keeps an oversized payload as a marker, not the payload", async ({
    expect,
  }) => {
    const events = ctx.alepha.inject(EstateEventService);
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-events-big");
    const estate = await rowOf(ctx, minted.id);

    const kept = await events.record(estate, {
      type: "event",
      id: "evt-big",
      kind: "backup.completed",
      at: new Date().toISOString(),
      data: { blob: "x".repeat(EstateEventService.MAX_DATA_BYTES + 1) },
    });
    expect(kept).toBe(true);
    const [row] = await events.list(minted.id);
    expect(row?.data).toMatchObject({ truncated: true });
    expect(
      await events.record(estate, {
        type: "event",
        id: "evt-big",
        kind: "backup.completed",
        at: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

/**
 * The one-time enrolment secret (#Q3165): what a provisioned server's
 * cloud-init carries, exchanged over HTTP for the long-lived secret, and
 * dead once the machine has connected with that.
 */
describe("EstateEnrolController, the enrolment exchange", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const exchange = (secret: string) =>
    fetch(
      ctx.url
        .replace("ws://", "http://")
        .replace(EstateSocketController.PATH, "/estates/enrol"),
      { method: "POST", headers: { authorization: `Bearer ${secret}` } },
    );

  it("exchanges the enrolment secret for one the socket accepts, and retires it on that first dial", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "prov-1");
    const enrolment = await ctx.estateApi.createEstateEnrolment(
      { params: { estateId: minted.id } },
      { user: owner },
    );
    expect(enrolment.secret).toMatch(/^enr_/);

    // The socket never takes an enrolment secret itself.
    expect(await refusal(ctx, enrolment.secret)).toBe(401);

    const answer = await exchange(enrolment.secret);
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { secret: string; slug: string };
    expect(body.slug).toBe("prov-1");
    expect(body.secret).toMatch(/^est_/);
    // The secret the estate was created with is gone.
    expect(await refusal(ctx, minted.secret)).toBe(401);

    const client = await connect(ctx, body.secret);
    await hello(client);
    await close(client);

    expect((await rowOf(ctx, minted.id)).enrolmentHash).toBeUndefined();
    expect((await exchange(enrolment.secret)).status).toBe(401);
  });

  it("survives a crash before the first dial: a second exchange mints again and retires the first", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "prov-2");
    const enrolment = await ctx.estateApi.createEstateEnrolment(
      { params: { estateId: minted.id } },
      { user: owner },
    );

    const first = (await (await exchange(enrolment.secret)).json()) as {
      secret: string;
    };
    const second = (await (await exchange(enrolment.secret)).json()) as {
      secret: string;
    };
    expect(second.secret).not.toBe(first.secret);
    expect(await refusal(ctx, first.secret)).toBe(401);

    const client = await connect(ctx, second.secret);
    await close(client);
  });

  it("refuses an expired, unknown or long-lived secret with 401 and hands over nothing", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "prov-3");
    const enrolment = await ctx.estateApi.createEstateEnrolment(
      { params: { estateId: minted.id } },
      { user: owner },
    );
    await ctx.repos.estates.updateById(minted.id, {
      enrolmentExpiresAt: new Date(0).toISOString(),
    });

    const expired = await exchange(enrolment.secret);
    expect(expired.status).toBe(401);
    expect(await expired.text()).not.toContain("est_");
    expect((await exchange("enr_nope")).status).toBe(401);
    expect((await exchange(minted.secret)).status).toBe(401);

    // Nothing moved: the secret the estate already had still connects.
    const client = await connect(ctx, minted.secret);
    await close(client);
  });
});

/**
 * Estate `ovh`, 2026-11-07: the connection dropped, Bay redialled and said
 * hello, and Lore listed the estate offline until `bay` was restarted 40
 * minutes later, with a deploy queued the whole time. The old socket's
 * close was a read then a write, and the reconnect landed between them.
 */
describe("EstateSocketController, a reconnect racing the old socket's close", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.gate.release();
    await ctx.alepha.stop();
  });

  const restart = {
    kind: "restart" as const,
    payload: { app: "lore", environment: "production" },
  };

  it("stays online after a drop without a close frame and a redial", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const first = await connect(ctx, minted.secret);
    await hello(first);

    first.ws.terminate();
    const second = await connect(ctx, minted.secret);
    await hello(second);
    await delay(100);

    expect(ctx.service.isOnline(await rowOf(ctx, minted.id))).toBe(true);
    await close(second);
  });

  it("stays online when the old close reads before the reconnect and writes after it", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const first = await connect(ctx, minted.secret);
    await hello(first);

    ctx.gate.holdNext();
    first.ws.close();
    // Either the close parked on its read (a read-then-write), or it has
    // already written its one conditional update.
    const deadline = Date.now() + 2_000;
    while (!ctx.gate.hit && !(await rowOf(ctx, minted.id)).disconnectedAt) {
      if (Date.now() > deadline) throw new Error("the close never landed");
      await delay(10);
    }
    // An unhit gate must not park the reconnect's own reads.
    if (!ctx.gate.hit) ctx.gate.release();

    const second = await connect(ctx, minted.secret);
    await hello(second);
    ctx.gate.release();
    await delay(100);

    const row = await rowOf(ctx, minted.id);
    expect(ctx.service.isOnline(row)).toBe(true);
    await close(second);
    expect(ctx.service.isOnline(await rowOf(ctx, minted.id))).toBe(false);
  });

  it("stays online when the old close lands inside the connect, at the same instant", async ({
    expect,
  }) => {
    // A Worker's clock does not move during I/O: both stamps are equal.
    ctx.alepha.inject(DateTimeProvider).pause();
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const first = await connect(ctx, minted.secret);
    await hello(first);
    const firstId = (await rowOf(ctx, minted.id)).connectionId;

    ctx.gate.holdNext();
    const second = await connect(ctx, minted.secret);
    const deadline = Date.now() + 2_000;
    while (
      !ctx.gate.hit &&
      (await rowOf(ctx, minted.id)).connectionId === firstId
    ) {
      if (Date.now() > deadline) throw new Error("the connect never landed");
      await delay(10);
    }
    await close(first);
    ctx.gate.release();
    await delay(100);

    expect(ctx.service.isOnline(await rowOf(ctx, minted.id))).toBe(true);
    await close(second);
  });

  it("heals on hello a row a lost race left naming another socket", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const client = await connect(ctx, minted.secret);
    await hello(client);
    const live = (await rowOf(ctx, minted.id)).connectionId;
    const later = new Date(Date.now() + 60_000).toISOString();
    await ctx.repos.estates.updateById(minted.id, {
      connectionId: "ws-gone",
      disconnectedAt: later,
    });
    expect(ctx.service.isOnline(await rowOf(ctx, minted.id))).toBe(false);

    client.frames.length = 0;
    await hello(client);

    const row = await rowOf(ctx, minted.id);
    expect(row.connectionId).toBe(live);
    expect(row.disconnectedAt ?? null).toBeNull();
    expect(ctx.service.isOnline(row)).toBe(true);
    await close(client);
  });

  it("delivers on the next stats frame a command queued while the row read offline", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const minted = await mint(ctx, owner, "ovh-1");
    const client = await connect(ctx, minted.secret);
    await hello(client);
    await ctx.repos.estates.updateById(minted.id, {
      disconnectedAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const queued = await ctx.commands.enqueue(
      await rowOf(ctx, minted.id),
      restart,
      owner.id,
    );
    expect(queued.status).toBe("pending");

    send(client, {
      type: "stats",
      cpuPercent: 10,
      memoryPercent: 20,
      at: new Date().toISOString(),
    });
    await waitFor(
      () => client.frames.some((frame) => frame.id === queued.id),
      "the command, on the stats frame",
    );
    const row = await waitForStatus(ctx, queued.id, "sent");
    expect(row.status).toBe("sent");

    // A second heartbeat does not send it again: only `pending` goes out.
    send(client, {
      type: "stats",
      cpuPercent: 10,
      memoryPercent: 20,
      at: new Date().toISOString(),
    });
    await waitFor(() => ctx.stats.frames.length === 2, "the second stats");
    await delay(50);
    expect(
      client.frames.filter((frame) => frame.id === queued.id),
    ).toHaveLength(1);
    await close(client);
  });
});
