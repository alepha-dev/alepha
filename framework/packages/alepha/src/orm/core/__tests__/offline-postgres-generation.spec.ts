import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $entity, $repository, db } from "../index.ts";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";
import { NodeSqliteProvider } from "../providers/drivers/NodeSqliteProvider.ts";
import { DrizzleKitProvider } from "../providers/DrizzleKitProvider.ts";

const invoices = $entity({
  name: "invoices",
  schema: z.object({
    id: db.primaryKey(),
    number: z.text(),
    status: z.enum(["draft", "sent", "paid"]),
    total: z.number(),
    paid: db.default(z.boolean(), false),
    createdAt: db.createdAt(),
  }),
  indexes: [{ column: "number", unique: true }],
});

class InvoiceApp {
  public readonly invoices = $repository(invoices);
}

/**
 * Every app generates its Postgres migrations, SQLite apps included (#Q3471):
 * the Postgres model is rebuilt from the app's entities through the Postgres
 * builder, with no Postgres provider, no URL and no connection.
 *
 * Neither `DATABASE_URL` nor `POSTGRES_TEST_URL` names a server here, so a
 * statement that reached for one would throw.
 */
describe("Postgres migrations generated offline from a SQLite app", () => {
  const sqliteApp = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:", POSTGRES_TEST_URL: "" },
    });
    // Imported, never started, as the CLI imports an app to generate its
    // migrations (`ALEPHA_CLI_IMPORT`): nothing opens a database.
    alepha.inject(InvoiceApp);
    return alepha;
  };

  it("produces Postgres SQL from the SQLite app's entities", async ({
    expect,
  }) => {
    const alepha = await sqliteApp();
    const provider = alepha.inject(DatabaseProvider);
    expect(provider).toBeInstanceOf(NodeSqliteProvider);

    const { statements } = await alepha
      .inject(DrizzleKitProvider)
      .generateMigration(provider, undefined, { dialect: "postgresql" });
    const sql = statements.join("\n");

    // Postgres only: a named enum type, timestamptz, and no schema qualifier.
    expect(sql).toContain(
      `CREATE TYPE "invoices_status_enum" AS ENUM('draft', 'sent', 'paid')`,
    );
    expect(sql).toContain(`CREATE TABLE "invoices"`);
    expect(sql).toContain(`"status" "invoices_status_enum" NOT NULL`);
    expect(sql).toContain(`"total" double precision NOT NULL`);
    expect(sql).toContain(
      `"created_at" timestamp with time zone DEFAULT now() NOT NULL`,
    );
    expect(sql).toContain(`"paid" boolean DEFAULT false NOT NULL`);
    expect(sql).not.toContain(`"public".`);

    // The SQLite model is untouched: same app, its own dialect.
    const own = await alepha
      .inject(DrizzleKitProvider)
      .generateMigration(provider, undefined, { withoutSchema: true });
    expect(own.statements.join("\n")).toContain("CREATE TABLE `invoices`");
  });

  it("names the entity and the column when the Postgres model refuses one", async ({
    expect,
  }) => {
    const left = $entity({
      name: "left_side",
      schema: z.object({
        id: db.primaryKey(),
        state: z.enum(["a", "b"]).meta({ name: "shared_state" }),
      }),
    });
    const right = $entity({
      name: "right_side",
      schema: z.object({
        id: db.primaryKey(),
        state: z.enum(["a", "c"]).meta({ name: "shared_state" }),
      }),
    });
    class Conflicting {
      public readonly left = $repository(left);
      public readonly right = $repository(right);
    }
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    alepha.inject(Conflicting);

    // SQLite has no enum types, so the app runs; its Postgres model cannot.
    await expect(
      alepha
        .inject(DrizzleKitProvider)
        .generateMigration(alepha.inject(DatabaseProvider), undefined, {
          dialect: "postgresql",
        }),
    ).rejects.toThrow(
      /Entity 'right_side', column 'state': the Postgres enum type 'shared_state'/,
    );
  });
});
