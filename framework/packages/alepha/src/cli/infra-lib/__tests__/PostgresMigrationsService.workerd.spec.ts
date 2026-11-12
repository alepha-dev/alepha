import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { describe, it } from "vitest";

import { withWorkerd } from "../../../ai/core/__tests__/workerdHarness.ts";

/**
 * The prebuilt deploy's Postgres migrator on workerd (#Q3508), where Lore's
 * deploy runner lives: the artifact in a memory filesystem, postgres.js over
 * `cloudflare:sockets`, the compose Postgres on the other end.
 */
describe("PostgresMigrationsService (workerd)", () => {
  it("applies migrations/postgres from a memory filesystem, once", async ({
    expect,
  }) => {
    const url = String(process.env.POSTGRES_TEST_URL);
    const schema = `test_pgmig_${randomBytes(4).toString("hex")}`;

    try {
      const result = await withWorkerd(
        {
          name: "postgres-migrations",
          source: `
import { Alepha } from "alepha";
import { PostgresMigrationsService } from "alepha/cli/infra-lib";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";

const PG_URL = ${JSON.stringify(url)};
export default { async fetch(request) {
 const { schema } = await request.json();
 const alepha = Alepha.create().with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
 const fs = alepha.inject(MemoryFileSystemProvider);
 await fs.writeFile("/artifact/migrations/postgres/20261112000000_baseline/migration.sql",
  'CREATE TABLE "notes" ("id" integer PRIMARY KEY, "body" text NOT NULL);\\n--> statement-breakpoint\\nCREATE INDEX "notes_body_idx" ON "notes" ("body");');
 const service = alepha.inject(PostgresMigrationsService);
 const first = await service.apply({ url: PG_URL, schema, root: "/artifact" });
 const second = await service.apply({ url: PG_URL, schema, root: "/artifact" });
 return Response.json({ first, second });
} };
`,
        },
        async (dispatch) => (await dispatch({ schema })).json(),
      );

      expect(result).toEqual({ first: 1, second: 0 });

      const client = postgres(url, { max: 1, onnotice: () => {} });
      const tables = await client`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ${schema}`;
      const journal = await client.unsafe(
        `SELECT name FROM drizzle."migrations_${schema}"`,
      );
      await client.end();
      expect(tables.map((it) => it.table_name)).toEqual(["notes"]);
      expect(journal.map((it) => it.name)).toEqual(["20261112000000_baseline"]);
    } finally {
      const admin = postgres(url, { max: 1, onnotice: () => {} });
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.unsafe(`DROP TABLE IF EXISTS drizzle."migrations_${schema}"`);
      await admin.end();
    }
  }, 120_000);
});
