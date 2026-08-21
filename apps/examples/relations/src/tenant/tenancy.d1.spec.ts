import { Alepha } from "alepha";
import { CloudflareD1Provider, DatabaseProvider } from "alepha/orm";
import type { Miniflare } from "miniflare";
import { afterAll } from "vitest";

import { d1Miniflare } from "../d1Miniflare.ts";
import { TenantApp, tenancyTests } from "./tenancyTests.ts";

/**
 * The dialect both `apps/lore` and `apps/club` actually deploy on.
 *
 * D1 is where the case for delegating to Drizzle is strongest and the evidence
 * was weakest: its driver is the only one constructed with `forbidJsonb: true`,
 * because D1's SQLite has no `jsonb` — so every relation has to aggregate
 * through `json_*` instead. Until this ran, that was read in the driver source
 * rather than executed.
 *
 * Miniflare provides a real D1 binding in-process, so this exercises the same
 * `workerd`-side implementation a deployed worker gets, with its own SQL
 * parser and error surface.
 */
const workers: Miniflare[] = [];

afterAll(async () => {
  await Promise.all(workers.map((mf) => mf.dispose()));
});

/**
 * D1 takes its schema from migration files rather than push-sync, and this
 * fixture has none. Rather than hand-write DDL that would drift from the
 * entities the moment one changed, boot the same app on SQLite — which does
 * push-sync — and copy out the schema the framework generated for itself.
 */
const schemaFromPushSync = async (): Promise<Array<string>> => {
  const source = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  source.inject(TenantApp);
  await source.start();

  const rows = await source
    .inject(DatabaseProvider)
    .execute(
      "select sql from sqlite_master where sql is not null and name not like 'sqlite_%'" as never,
    );

  await source.stop();

  return rows.map((row) => String(row.sql));
};

tenancyTests("cloudflare d1", async () => {
  const statements = await schemaFromPushSync();

  const mf = d1Miniflare();
  workers.push(mf);

  const alepha = Alepha.create({
    env: { DATABASE_URL: "d1://DB" },
  }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });

  alepha.store.set("cloudflare.env", await mf.getBindings());

  const app = alepha.inject(TenantApp);
  await alepha.start();

  const provider = alepha.inject(DatabaseProvider);
  for (const statement of statements) {
    await provider.execute(statement as never);
  }

  return { alepha, app };
});
