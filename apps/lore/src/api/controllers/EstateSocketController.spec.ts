import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import WebSocket from "ws";

import { TestEntityRepositories } from "../../../test/fixtures/entities.ts";
import { estateCommands } from "../entities/estateCommands.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import type { EstateStatsFrame } from "../schemas/estateStatsFrameSchema.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateCommandTransport } from "../services/EstateCommandTransport.ts";
import { EstateService } from "../services/EstateService.ts";
import { EstateStatsService } from "../services/EstateStatsService.ts";
import { WebSocketEstateCommandTransport } from "../services/WebSocketEstateCommandTransport.ts";
import { EstateController } from "./EstateController.ts";
import { EstateSocketController } from "./EstateSocketController.ts";

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
  entities: TestEntityRepositories;
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
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(EstateRepositories);

  await alepha.start();

  return {
    alepha,
    estateApi: alepha.inject(EstateController),
    commands: alepha.inject(EstateCommandService),
    service: alepha.inject(EstateService),
    stats: alepha.inject(RecordingStatsService),
    repos,
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

const mint = async (ctx: TestContext, owner: UserAccountToken, slug: string) =>
  ctx.estateApi.createEstate({ body: { slug } }, { user: owner });

const rowOf = (ctx: TestContext, id: string) =>
  ctx.repos.estates.getOne({ where: { id: { eq: id } } });

const connect = (ctx: TestContext, secret: string): Promise<Client> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(ctx.url, {
      headers: { authorization: `Bearer ${secret}` },
    } as any);
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
    } as any);
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

    const client = await connect(ctx, rotated.secret);
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
