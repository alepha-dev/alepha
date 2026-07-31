import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { describe, expect, it } from "vitest";
import { errorGroups } from "../src/api/entities/errorGroups.ts";
import { pulseApps } from "../src/api/entities/pulseApps.ts";
import { uniquesDaily } from "../src/api/entities/uniquesDaily.ts";
import { viewsHourly } from "../src/api/entities/viewsHourly.ts";
import { BayAdminApi } from "../src/api/index.ts";
import { bayAppSchema } from "../src/api/schemas/bayAppSchema.ts";
import { AppKeyService } from "../src/api/services/AppKeyService.ts";
import { IngestService } from "../src/api/services/IngestService.ts";

/**
 * Exposes the repositories the assertions need, without reaching into the
 * service under test.
 */
class Probe {
  apps = $repository(pulseApps);
  errors = $repository(errorGroups);
  views = $repository(viewsHourly);
  uniques = $repository(uniquesDaily);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      // The root vitest config points at Postgres for the framework's own
      // suites; Pulse is SQLite, and each test wants its own empty one.
      DATABASE_URL: ":memory:",
    },
  }).with(BayAdminApi);
  const ingest = alepha.inject(IngestService);
  const keys = alepha.inject(AppKeyService);
  const probe = alepha.inject(Probe);
  await alepha.start();

  const key = keys.generate();
  const app = await probe.apps.create({
    slug: "demo",
    name: "Demo",
    kind: "external",
    ingestKeyHash: key.hash,
    ingestKeyPrefix: key.prefix,
  });

  return { alepha, ingest, keys, probe, app, token: key.token };
};

const anError = (message: string, frame = "at f (app.js:1:1)") => ({
  name: "TypeError",
  message,
  stack: `TypeError: ${message}\n    ${frame}`,
  sourceUrl: "https://app/",
});

describe("IngestService", () => {
  it("keeps one group for the same failure, adding up the counts", async () => {
    const { ingest, probe, app } = await setup();

    // Two batches, each already collapsed by the sender.
    await ingest.absorb(app, { errors: [{ ...anError("boom"), count: 40 }] });
    await ingest.absorb(app, { errors: [{ ...anError("boom"), count: 2 }] });

    const groups = await probe.errors.findMany({ where: { appId: app.id } });
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(42);
  });

  it("does not let the stack sample drift to the newest occurrence", async () => {
    const { ingest, probe, app } = await setup();

    await ingest.absorb(app, { errors: [anError("first")] });
    await ingest.absorb(app, { errors: [anError("second")] });

    // Otherwise the stored stack stops matching the stored first sighting.
    const [group] = await probe.errors.findMany({ where: { appId: app.id } });
    expect(group.stackSample).toContain("first");
  });

  it("separates two apps reporting the same crash", async () => {
    const { alepha, ingest, probe, app } = await setup();
    const keys = alepha.inject(AppKeyService);
    const other = await probe.apps.create({
      slug: "other",
      name: "Other",
      kind: "external",
      ...(() => {
        const k = keys.generate();
        return { ingestKeyHash: k.hash, ingestKeyPrefix: k.prefix };
      })(),
    });

    await ingest.absorb(app, { errors: [anError("boom")] });
    await ingest.absorb(other, { errors: [anError("boom")] });

    // Scoping is carried by the app, not by the fingerprint — which is what
    // lets a fingerprint stay portable across sinks.
    expect(
      await probe.errors.findMany({ where: { appId: app.id } }),
    ).toHaveLength(1);
    expect(
      await probe.errors.findMany({ where: { appId: other.id } }),
    ).toHaveLength(1);
  });

  it("counts a visitor once a day however many pages they open", async () => {
    const { ingest, probe, app } = await setup();

    await ingest.absorb(app, {
      views: [{ path: "/" }, { path: "/about" }],
      visitor: "v1",
    });
    await ingest.absorb(app, { views: [{ path: "/pricing" }], visitor: "v1" });

    expect(
      await probe.uniques.findMany({ where: { appId: app.id } }),
    ).toHaveLength(1);
  });

  it("collapses query strings so the table stays bounded by page count", async () => {
    const { ingest, probe, app } = await setup();

    await ingest.absorb(app, {
      views: [{ path: "/search?q=a" }, { path: "/search?q=b" }],
    });

    // Otherwise every distinct query is its own row, and rolling up on write
    // stops being affordable.
    const rows = await probe.views.findMany({ where: { appId: app.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/search");
    expect(rows[0].count).toBe(2);
  });
});

describe("AppKeyService", () => {
  it("stores only a hash, so a leaked database is not a leaked fleet", async () => {
    const { probe, app, token } = await setup();

    const stored = await probe.apps.findOne({ where: { id: app.id } });
    expect(stored?.ingestKeyHash).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("resolves a live key and refuses a revoked one identically to an unknown one", async () => {
    const { alepha, probe, app, token } = await setup();
    const keys = alepha.inject(AppKeyService);

    expect((await keys.resolve(token))?.id).toBe(app.id);

    await probe.apps.updateById(app.id, {
      revokedAt: new Date().toISOString(),
    } as any);

    // Telling the two apart would let anyone probe for keys that once existed.
    expect(await keys.resolve(token)).toBeUndefined();
    expect(await keys.resolve("tk_never_existed")).toBeUndefined();
  });

  it("reads only a well-formed bearer", async () => {
    const { alepha } = await setup();
    const keys = alepha.inject(AppKeyService);

    expect(keys.bearer("Bearer tk_abc")).toBe("tk_abc");
    expect(keys.bearer("tk_abc")).toBeUndefined();
    expect(keys.bearer("Bearer ")).toBeUndefined();
    expect(keys.bearer(undefined)).toBeUndefined();
  });
});

describe("bayAppSchema", () => {
  it("should carry the supervisor's usage reading through to the browser", () => {
    /*
      The response schema is what gets serialized, so a field it does not name
      is dropped on the way out.

      `usage` was added to the TypeScript interface, to the client type and to
      the component that renders it. Typecheck was green, the API answered 200,
      and the browser received a list with no usage in it — no error, nothing in
      a log, just a column that was silently always empty.
    */
    const parsed = bayAppSchema.parse({
      name: "demo",
      env: "production",
      domain: "demo.example.com",
      release: "2026-07-31-120000",
      port: 4000,
      runtime: "node",
      running: true,
      usage: {
        memoryBytes: 94371840,
        cpuSeconds: 12.5,
        tasks: 17,
        restarts: 2,
        startedAt: "2026-07-31T09:14:22Z",
        pid: 4213,
      },
    });

    expect(parsed.usage?.memoryBytes).toBe(94371840);
    expect(parsed.usage?.restarts).toBe(2);
    expect(parsed.usage?.startedAt).toBe("2026-07-31T09:14:22Z");
  });

  it("should accept an app the supervisor knows nothing about", () => {
    // An unsupervised child process in development, or an older bay-go. The
    // absence must not be an error, and must not become a zero.
    const parsed = bayAppSchema.parse({
      name: "demo",
      env: "production",
      domain: "demo.example.com",
      release: "2026-07-31-120000",
      port: 4000,
      runtime: "node",
    });

    expect(parsed.usage).toBeUndefined();
    expect(parsed.running).toBeUndefined();
  });
});
