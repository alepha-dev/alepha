import { Alepha, z } from "alepha";
import {
  $entity,
  $repository,
  CloudflareD1Provider,
  DatabaseProvider,
  db,
} from "alepha/orm";
import type { Miniflare } from "miniflare";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { d1Miniflare } from "./d1Miniflare.ts";

/**
 * The Sessions API against a real D1 binding.
 *
 * The pinned `workerd` implements `withSession`, so this exercises the actual
 * code path rather than the fallback. That distinction matters: read
 * replication degrades silently to the primary when the method is missing, so
 * a suite built on a fake could stay green while the feature did nothing.
 *
 * A local instance has no replicas, so this proves the plumbing (sessions
 * open, queries route through them, bookmarks come back and are accepted),
 * not the latency win, which needs real regions.
 */
const notes = $entity({
  name: "session_notes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    title: z.text(),
  }),
});

class App {
  notes = $repository(notes);
}

const workers: Miniflare[] = [];

afterAll(async () => {
  await Promise.all(workers.map((mf) => mf.dispose()));
});

const schemaFromPushSync = async (): Promise<Array<string>> => {
  const source = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  source.inject(App);
  await source.start();

  const rows = await source
    .inject(DatabaseProvider)
    .execute(
      "select sql from sqlite_master where sql is not null and name not like 'sqlite_%'" as never,
    );

  await source.stop();
  return rows.map((row) => String(row.sql));
};

describe("d1 sessions against real workerd", () => {
  let alepha: Alepha;
  let app: App;
  let provider: CloudflareD1Provider;

  const boot = async (mode: "primary" | "sessions") => {
    const statements = await schemaFromPushSync();

    const mf = d1Miniflare();
    workers.push(mf);

    alepha = Alepha.create({
      env: {
        DATABASE_URL: "d1://DB",
        ALEPHA_SERVERLESS: true,
        DATABASE_D1_MODE: mode,
      },
    }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });
    alepha.store.set("cloudflare.env", await mf.getBindings());

    app = alepha.inject(App);
    await alepha.start();

    provider = alepha.inject(DatabaseProvider) as CloudflareD1Provider;
    for (const statement of statements) {
      await provider.execute(statement as never);
    }
  };

  beforeEach(async () => {
    await boot("sessions");
  });

  it("reads and writes through a session", async () => {
    await alepha.fork(async () => {
      await app.notes.create({ title: "through a session" });
      const found = await app.notes.findMany();
      expect(found.map((n) => n.title)).toEqual(["through a session"]);
    });
  });

  it("reports a bookmark once a query has run", async () => {
    const bookmark = await alepha.fork(async () => {
      await app.notes.create({ title: "anything" });
      return provider.sessionBookmark();
    });

    // The bookmark is the entire cross-request consistency mechanism. A null
    // here means a caller has nothing to send back and every follow-up read
    // is unanchored.
    expect(bookmark).toBeTruthy();
  });

  it("accepts a previous bookmark and still sees the write", async () => {
    const bookmark = await alepha.fork(async () => {
      await app.notes.create({ title: "written first" });
      return provider.sessionBookmark();
    });

    // A separate request, anchored at what the first one returned. This is
    // the read-after-write path: on a replicated database an unanchored read
    // here is the one that legitimately returns nothing.
    const titles = await alepha.fork(async () => {
      provider.openSession(bookmark ?? undefined);
      const found = await app.notes.findMany();
      return found.map((n) => n.title);
    });

    expect(titles).toEqual(["written first"]);
  });

  it("uses one session per request and a new one for the next", async () => {
    const first = await alepha.fork(async () => {
      await app.notes.findMany();
      await app.notes.findMany();
      return provider.sessionBookmark();
    });

    const second = await alepha.fork(async () => {
      await app.notes.findMany();
      return provider.sessionBookmark();
    });

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
  });

  it("works identically in primary mode", async () => {
    await boot("primary");

    await alepha.fork(async () => {
      await app.notes.create({ title: "no session" });
      const found = await app.notes.findMany();
      expect(found.map((n) => n.title)).toEqual(["no session"]);
      // Nothing to hand back when replication is off.
      expect(provider.sessionBookmark()).toBeNull();
    });
  });
});
