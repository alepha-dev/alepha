import { randomBytes } from "node:crypto";

import { Alepha } from "alepha";
import { DatabaseProvider, DbMigrationError } from "alepha/orm";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { AlephaOrmPostgres } from "../index.ts";
import { NodePostgresProvider } from "../providers/NodePostgresProvider.ts";

/**
 * Two instances booting at once on one database: the second waits for the
 * first one's migration instead of crashing on the lock, and never migrates
 * at the same time. Against the compose Postgres, since the lock is the
 * database's own.
 */

const probe = {
  schema: "",
  active: 0,
  maxActive: 0,
  runs: 0,
  applied: 0,
  lockTimeout: 300_000,
};

class LockProbeProvider extends NodePostgresProvider {
  protected override schemaForTesting = probe.schema;
  protected override readonly migrationLockTimeout = probe.lockTimeout;

  /**
   * Stands in for the migrator. Test mode's schema push replays every CREATE
   * from scratch, so it cannot run twice on one schema; production's
   * migrator skips what its table says is applied. This does the same: the
   * second instance, once it holds the lock, finds the work done.
   */
  public override async migrate(): Promise<void> {
    probe.active += 1;
    probe.maxActive = Math.max(probe.maxActive, probe.active);
    try {
      // Long enough that the second instance arrives while this one is still
      // migrating.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await this.execute(
        sql.raw(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`),
      );
      await this.execute(
        sql.raw(
          `CREATE TABLE IF NOT EXISTS "${this.schema}"."applied" (id integer PRIMARY KEY)`,
        ),
      );
      const rows = await this.execute(
        sql.raw(`SELECT id FROM "${this.schema}"."applied"`),
      );
      if (rows.length === 0) {
        await this.execute(
          sql.raw(`INSERT INTO "${this.schema}"."applied" (id) VALUES (1)`),
        );
        probe.applied += 1;
      }
      probe.runs += 1;
    } finally {
      probe.active -= 1;
    }
  }
}

const reset = (lockTimeout = 300_000) => {
  probe.schema = `test_alepha_${Math.floor(new Date().getTime() / 1000)}_${randomBytes(4).toString("hex")}`;
  probe.active = 0;
  probe.maxActive = 0;
  probe.runs = 0;
  probe.applied = 0;
  probe.lockTimeout = lockTimeout;
};

const container = () =>
  Alepha.create()
    .with({ provide: DatabaseProvider, use: LockProbeProvider })
    .with(AlephaOrmPostgres);

const causes = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  let current = error;
  while (current) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
};

describe("Postgres migration lock", () => {
  it("lets two containers starting at once both boot, one migration at a time", async () => {
    reset();
    // Test mode creates each container's schema at start, before the lock.
    // Created here, so two containers sharing one do not race on the catalog.
    const admin = postgres(String(process.env.DATABASE_URL), { max: 1 });
    await admin.unsafe(`CREATE SCHEMA IF NOT EXISTS "${probe.schema}"`);
    await admin.end();
    const first = container();
    const second = container();

    try {
      await Promise.all([first.start(), second.start()]);

      expect(first.isStarted()).toBe(true);
      expect(second.isStarted()).toBe(true);
      expect(probe.runs).toBe(2);
      expect(probe.maxActive).toBe(1);
      expect(probe.applied).toBe(1);
    } finally {
      await second.stop();
      await first.stop();
    }
  });

  it("fails the boot with a DbMigrationError naming the lock when the wait times out", async () => {
    reset(300);
    const key = `alepha:migrate:${probe.schema}`;
    const holder = postgres(String(process.env.DATABASE_URL), { max: 1 });

    try {
      await holder.unsafe("SELECT pg_advisory_lock(hashtext($1))", [key]);

      const app = container();
      const error = await app.start().then(
        () => undefined,
        (err: unknown) => err,
      );
      await app.stop().catch(() => {});

      const chain = causes(error);
      expect(chain.some((it) => it instanceof DbMigrationError)).toBe(true);
      expect(
        chain.some(
          (it) => it instanceof Error && it.message.includes(`'${key}'`),
        ),
      ).toBe(true);
      expect(probe.runs).toBe(0);
    } finally {
      await holder.unsafe("SELECT pg_advisory_unlock(hashtext($1))", [key]);
      await holder.end();
    }
  });
});
