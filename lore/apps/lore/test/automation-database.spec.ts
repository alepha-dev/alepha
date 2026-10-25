import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AutomationD1Provider, AutomationDatabase } from "@lore/core/api";
import { Alepha } from "alepha";
import {
  AlephaOrm,
  DatabaseProvider,
  sql,
  type D1Database,
  type D1DatabaseSession,
} from "alepha/orm";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { getPlatformProxy } from "wrangler";

class TestAutomationD1Provider extends AutomationD1Provider {
  public override async migrate(): Promise<void> {}
}

/**
 * A recording adapter around Wrangler's real local D1 binding, not an
 * in-memory transaction substitute. Both primary and session queries execute.
 */
class RecordingD1 {
  public primaryReads = 0;
  public sessionReads = 0;
  public sessions = 0;
  public readonly binding: D1Database;
  constructor(binding: D1Database) {
    this.binding = binding;
  }
  public prepare(query: string) {
    this.primaryReads += 1;
    return this.binding.prepare(query);
  }
  public batch<T>(statements: Parameters<D1Database["batch"]>[0]) {
    return this.binding.batch<T>(statements);
  }
  public exec(query: string) {
    return this.binding.exec(query);
  }
  public dump() {
    return this.binding.dump();
  }
  public withSession(constraint?: string): D1DatabaseSession {
    this.sessions += 1;
    const session = this.binding.withSession!(constraint);
    return {
      prepare: (query) => {
        this.sessionReads += 1;
        return session.prepare(query);
      },
      batch: (statements) => session.batch(statements),
      getBookmark: () => session.getBookmark(),
    };
  }
}

describe("Automation database boundaries", () => {
  let directory: string;
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
  let alepha: Alepha | undefined;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "lore-automation-d1-"));
    const path = join(directory, "wrangler.json");
    await writeFile(
      path,
      JSON.stringify({
        name: "lore-automation-test",
        compatibility_date: "2026-01-01",
        d1_databases: [
          {
            binding: "DB",
            database_name: "automation-test",
            database_id: "00000000-0000-0000-0000-000000000001",
          },
        ],
      }),
    );
    proxy = await getPlatformProxy<{ DB: D1Database }>({
      configPath: path,
      persist: false,
      remoteBindings: false,
    });
  });
  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });
  afterAll(async () => {
    await proxy?.dispose();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  for (const driver of ["sqlite", "d1"] as const) {
    it(`commits or rolls back the source and intent together on ${driver}`, async ({
      expect,
    }) => {
      alepha = Alepha.create({
        env: {
          DATABASE_URL: driver === "d1" ? "d1://DB" : ":memory:",
          SERVER_PORT: 0,
          LOG_LEVEL: "error",
        },
      });
      if (driver === "d1") {
        alepha.with({
          provide: DatabaseProvider,
          use: TestAutomationD1Provider,
        });
        alepha.set("cloudflare.env", { DB: proxy.env.DB });
      }
      alepha.with(AlephaOrm);
      const database = alepha.inject(AutomationDatabase);
      const provider = alepha.inject(DatabaseProvider);
      await alepha.start();
      await database.batch([
        "CREATE TABLE source_rows (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)",
        "CREATE TABLE event_intents (id TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL)",
      ]);
      await database.batch([
        sql`INSERT INTO source_rows VALUES (1, 1) RETURNING id`,
        sql`INSERT INTO event_intents VALUES ('first', 1) RETURNING id`,
      ]);
      await expect(
        database.batch([
          sql`UPDATE source_rows SET value = 2 WHERE id = 1 RETURNING id`,
          sql`INSERT INTO event_intents VALUES ('first', 2) RETURNING id`,
        ]),
      ).rejects.toThrow("Atomic automation batch failed");
      expect(
        await provider.execute("SELECT value FROM source_rows WHERE id = 1"),
      ).toEqual([{ value: 1 }]);
      const result = await database.batch([
        sql`UPDATE source_rows SET value = 3 WHERE id = 1 RETURNING id`,
        sql`INSERT INTO event_intents VALUES ('second', 3) RETURNING id`,
      ]);
      expect(result[0]).toEqual([{ id: 1 }]);
      expect(
        await provider.execute(
          "SELECT value FROM event_intents WHERE id = 'second'",
        ),
      ).toEqual([{ value: 3 }]);
    });
  }

  it("routes every query in an authority context to the primary even when normal reads use sessions", async ({
    expect,
  }) => {
    const binding = new RecordingD1(proxy.env.DB);
    alepha = Alepha.create({
      env: {
        DATABASE_URL: "d1://DB",
        DATABASE_D1_MODE: "sessions",
        SERVER_PORT: 0,
        LOG_LEVEL: "error",
      },
    })
      .with({ provide: DatabaseProvider, use: TestAutomationD1Provider })
      .with(AlephaOrm);
    alepha.set("cloudflare.env", { DB: binding });
    const database = alepha.inject(AutomationDatabase);
    const provider = alepha.inject(DatabaseProvider);
    await alepha.start();
    await provider.execute("SELECT 1 AS value");
    expect(binding.sessionReads).toBeGreaterThan(0);
    const reads = binding.primaryReads;
    const sessions = binding.sessionReads;
    await database.primary(async () => {
      await provider.execute("SELECT 2 AS value");
      await provider.execute("SELECT 3 AS value");
    });
    expect(binding.primaryReads - reads).toBe(2);
    expect(binding.sessionReads).toBe(sessions);
    await provider.execute("SELECT 4 AS value");
    expect(binding.sessionReads).toBe(sessions + 1);
  });
});
