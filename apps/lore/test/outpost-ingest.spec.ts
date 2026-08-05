import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, expect, it } from "vitest";
import { outpostApps } from "../src/api/entities/outpostApps.ts";
import { outpostEvents } from "../src/api/entities/outpostEvents.ts";
import { outposts } from "../src/api/entities/outposts.ts";
import { projects } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import { OutpostTokenService } from "../src/api/services/OutpostTokenService.ts";

class Probe {
  projects = $repository(projects);
  outposts = $repository(outposts);
  apps = $repository(outpostApps);
  events = $repository(outpostEvents);
}

/**
 * Boots a real HTTP server rather than calling the handler directly.
 *
 * `/outposts/report` is a `$route`, and the difference from an `$action` is
 * invisible to a handler call — it only shows up in the URL the server binds.
 * Declared as an `$action` by mistake it would sit under `/api`, answer every
 * direct-call test, and 404 the machines it exists for.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaServerCors);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  const tokens = alepha.inject(OutpostTokenService);
  const server = alepha.inject(ServerProvider);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const project = await probe.projects.create({
    title: "Test",
    createdBy: owner.id,
  } as any);

  const minted = tokens.mint();
  const outpost = await probe.outposts.create({
    projectId: project.id,
    label: "OVH Bay",
    tokenHash: minted.hash,
    tokenPrefix: minted.prefix,
    createdBy: owner.id,
  });

  // No default token: passing `undefined` has to MEAN "send no header". A
  // default here silently turned the unauthenticated case into an
  // authenticated one, and the test passed against a 204 it should have
  // refused.
  const report = (body: unknown, token: string | undefined) =>
    fetch(`${server.hostname}/outposts/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  return { alepha, probe, outpost, minted, report };
};

const oneApp = {
  apps: [
    {
      app: "lore",
      environment: "production",
      domains: ["lore.example", "www.lore.example"],
      release: "2026-08-03-101500",
      running: true,
      memoryBytes: 182_000_000,
      restarts: 0,
      lastRequestAt: "2026-08-03T09:00:00Z",
    },
  ],
};

describe("outpost ingest", () => {
  it("refuses a missing, malformed or unknown token alike", async () => {
    // All three answer 401. Distinguishing them would let anyone with the URL
    // discover whether a token ever existed.
    const { report } = await setup();
    for (const token of [undefined, "not-a-bearer", "op_wrong"]) {
      const res = await report(oneApp, token);
      expect(res.status).toBe(401);
    }
  });

  it("stores the snapshot the machine reported", async () => {
    const { probe, outpost, report, minted } = await setup();
    const res = await report({ agent: "bay 0.25.0", ...oneApp }, minted.token);
    expect(res.status).toBe(204);

    const stored = await probe.apps.findMany({
      where: { outpostId: { eq: outpost.id } },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].app).toBe("lore");
    expect(stored[0].domains).toEqual(["lore.example", "www.lore.example"]);
    expect(stored[0].running).toBe(true);

    // The agent string is what the machine says it runs, and it only exists
    // once the machine has spoken.
    const [row] = await probe.outposts.findMany({
      where: { id: { eq: outpost.id } },
    });
    expect(row.agent).toBe("bay 0.25.0");
    expect(row.lastSeenAt).toBeTruthy();
  });

  it("replaces the snapshot rather than accumulating it", async () => {
    // The row means "what is true now". A second report with different numbers
    // must overwrite, not append.
    const { probe, outpost, report, minted } = await setup();
    await report(oneApp, minted.token);
    await report(
      { apps: [{ ...oneApp.apps[0], running: false, restarts: 3 }] },
      minted.token,
    );

    const stored = await probe.apps.findMany({
      where: { outpostId: { eq: outpost.id } },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].running).toBe(false);
    expect(stored[0].restarts).toBe(3);
  });

  it("forgets an app the machine stopped reporting", async () => {
    // A row saying "running" about an app that no longer exists is worse than
    // no row at all.
    const { probe, outpost, report, minted } = await setup();
    await report(
      {
        apps: [
          oneApp.apps[0],
          { app: "old", environment: "production", running: true },
        ],
      },
      minted.token,
    );
    expect(
      await probe.apps.findMany({ where: { outpostId: { eq: outpost.id } } }),
    ).toHaveLength(2);

    await report(oneApp, minted.token);
    const stored = await probe.apps.findMany({
      where: { outpostId: { eq: outpost.id } },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].app).toBe("lore");
  });

  it("stores a resent event exactly once", async () => {
    // The delivery guarantee. The machine holds no cursor and resends its whole
    // history every minute by design, so at-least-once from the machine has to
    // become exactly-once in the table — and the unique index is what does it.
    const { probe, outpost, report, minted } = await setup();
    const events = [
      {
        app: "lore",
        environment: "production",
        kind: "deploy" as const,
        release: "2026-08-03-101500",
        occurredAt: "2026-08-03T10:15:00Z",
      },
    ];
    await report({ ...oneApp, events }, minted.token);
    await report({ ...oneApp, events }, minted.token);
    await report({ ...oneApp, events }, minted.token);

    const stored = await probe.events.findMany({
      where: { outpostId: { eq: outpost.id } },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe("deploy");
    expect(stored[0].release).toBe("2026-08-03-101500");
  });

  it("keeps two events that differ only by when they happened", async () => {
    // The flip side of the dedupe: two deploys of the same release at different
    // times are two events, and collapsing them would erase a rollback.
    const { probe, outpost, report, minted } = await setup();
    await report(
      {
        ...oneApp,
        events: [
          {
            app: "lore",
            environment: "production",
            kind: "deploy" as const,
            release: "r1",
            occurredAt: "2026-08-03T10:15:00Z",
          },
          {
            app: "lore",
            environment: "production",
            kind: "deploy" as const,
            release: "r1",
            occurredAt: "2026-08-03T11:00:00Z",
          },
        ],
      },
      minted.token,
    );
    expect(
      await probe.events.findMany({ where: { outpostId: { eq: outpost.id } } }),
    ).toHaveLength(2);
  });

  it("survives a report from a machine hosting nothing", async () => {
    // A freshly installed Bay is a valid outpost with an empty world, and it
    // must be able to say so — that report is what turns "never connected"
    // into "connected, hosting nothing".
    const { probe, outpost, report, minted } = await setup();
    expect((await report({ apps: [] }, minted.token)).status).toBe(204);
    const [row] = await probe.outposts.findMany({
      where: { id: { eq: outpost.id } },
    });
    expect(row.lastSeenAt).toBeTruthy();
  });
});

describe("outpost tokens", () => {
  it("resolves its own token and nothing else", async () => {
    const { alepha, minted, outpost } = await setup();
    const tokens = alepha.inject(OutpostTokenService);

    expect((await tokens.verify(minted.token))?.id).toBe(outpost.id);
    expect(await tokens.verify("op_nope")).toBeUndefined();
    expect(await tokens.verify(undefined)).toBeUndefined();
  });

  it("mints a distinguishable prefix", async () => {
    // `op_` rather than `sg_` so the two are never confused in a log, a .env or
    // a support conversation — they authorise different things.
    const { alepha } = await setup();
    const minted = alepha.inject(OutpostTokenService).mint();
    expect(minted.token.startsWith("op_")).toBe(true);
    expect(minted.prefix.startsWith("op_")).toBe(true);
    expect(minted.hash).not.toBe(minted.token);
  });
});

/**
 * The wire contract, frozen as a literal.
 *
 * This exact string is what Bay's Go structs marshal to — captured from
 * `internal/connector`, not written by hand. It exists because the two ends are
 * in different languages with no shared definition, and the failure mode of a
 * mismatch is silent in both directions: Bay would log a 400 once a minute into
 * a file nobody reads, and Lore would simply see a machine go quiet.
 *
 * If this test fails, one side moved. Fix the other, or move both.
 */
describe("wire contract with bay", () => {
  const FROM_BAY = `{"agent":"bay dev","baseDomain":"bay.alepha.dev","apps":[{"app":"lore","environment":"production","domains":["lore.test"],"release":"2026-08-03-093913","running":true,"memoryBytes":182000000,"restarts":2,"lastRequestAt":"2026-08-03T09:00:00Z"}],"events":[{"app":"lore","environment":"production","kind":"deploy","release":"2026-08-03-093913","occurredAt":"2026-08-03T09:39:13Z"}]}`;

  it("accepts exactly what bay marshals", async () => {
    const { probe, outpost, report, minted } = await setup();
    const res = await report(JSON.parse(FROM_BAY), minted.token);
    expect(res.status).toBe(204);

    const [app] = await probe.apps.findMany({
      where: { outpostId: { eq: outpost.id } },
    });
    expect(app.app).toBe("lore");
    expect(app.memoryBytes).toBe(182000000);
    expect(app.restarts).toBe(2);
    expect(app.domains).toEqual(["lore.test"]);

    const [event] = await probe.events.findMany({
      where: { outpostId: { eq: outpost.id } },
    });
    expect(event.kind).toBe("deploy");
    expect(event.occurredAt).toBe("2026-08-03T09:39:13Z");
  });
});
