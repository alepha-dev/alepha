import { Alepha } from "alepha";
import {
  CloudflareD1Provider,
  DatabaseProvider,
  AlephaOrmTestPostgres,
} from "alepha/orm";
import { Miniflare } from "miniflare";
import { afterAll } from "vitest";

import { AlephaApiJobs } from "../index.ts";

/**
 * The three dialects the steps specs run on: Postgres (what every other jobs
 * spec boots), SQLite in memory, and Cloudflare D1 through a real Miniflare
 * binding.
 *
 * A step write is one `UPDATE` with no transaction, which is the whole reason
 * it is correct on D1, and the `steps` JSON is a `jsonb` on Postgres and a
 * `text` on SQLite and D1: these are the differences the dialect matrix is
 * for. The rest of the jobs suite stays on Postgres alone.
 *
 * Written beside the spec rather than imported from `apps/examples/relations`,
 * which holds the same Miniflare fixture: a package cannot import from an app.
 */
export interface JobStepsDialect {
  name: "postgres" | "sqlite" | "d1";
  /**
   * A container on this dialect with `AlephaApiJobs`, not started. `with`
   * receives it before the jobs module is registered, which is when a
   * substitution of one of its services has to land.
   */
  create: (with_?: (alepha: Alepha) => Alepha) => Alepha;
  /**
   * Start the container and make sure `job_executions` exists.
   */
  start: (alepha: Alepha) => Promise<void>;
}

const workers: Miniflare[] = [];

afterAll(async () => {
  await Promise.all(workers.map((mf) => mf.dispose()));
});

/**
 * D1 takes its schema from migration files, not push-sync. Boot the jobs
 * module on SQLite, which does push-sync, and copy out the schema the
 * framework generated, so the fixture cannot drift from the entities.
 */
let d1Schema: Promise<string[]> | undefined;
const schemaFromPushSync = (): Promise<string[]> => {
  d1Schema ??= (async () => {
    const source = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    }).with(AlephaApiJobs);
    await source.start();
    const rows = await source
      .inject(DatabaseProvider)
      .execute(
        "select sql from sqlite_master where sql is not null and name not like 'sqlite_%'",
      );
    await source.stop();
    return rows.map((row) => String(row.sql));
  })();
  return d1Schema;
};

const d1Miniflare = (): Miniflare => {
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: "job-steps-d1",
          compatibilityDate: "2000-01-01",
          manifest: {
            mainModule: "index.mjs",
            modules: {
              "index.mjs": { type: "esm", contents: "export default {};" },
            },
          },
          env: { DB: { type: "d1", id: ":memory:" } },
        },
      },
    ],
  });
  workers.push(mf);
  return mf;
};

const identity = (alepha: Alepha) => alepha;

export const jobStepsDialects: JobStepsDialect[] = [
  {
    name: "postgres",
    create: (with_ = identity) =>
      with_(Alepha.create().with(AlephaOrmTestPostgres)).with(AlephaApiJobs),
    start: async (alepha) => {
      await alepha.start();
    },
  },
  {
    name: "sqlite",
    create: (with_ = identity) =>
      with_(Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } })).with(
        AlephaApiJobs,
      ),
    start: async (alepha) => {
      await alepha.start();
    },
  },
  {
    name: "d1",
    create: (with_ = identity) =>
      with_(
        Alepha.create({ env: { DATABASE_URL: "d1://DB" } }).with({
          provide: DatabaseProvider,
          use: CloudflareD1Provider,
        }),
      ).with(AlephaApiJobs),
    start: async (alepha) => {
      const statements = await schemaFromPushSync();
      const mf = d1Miniflare();
      alepha.store.set("cloudflare.env", await mf.getBindings());
      await alepha.start();
      const provider = alepha.inject(DatabaseProvider);
      for (const statement of statements) {
        await provider.execute(statement);
      }
    },
  },
];
