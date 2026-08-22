import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, z } from "alepha";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { $entity, $repository, db, sql } from "../index.ts";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";
import { DrizzleKitProvider } from "../providers/DrizzleKitProvider.ts";

/**
 * Drives the push path directly.
 *
 * `synchronize()` cannot be used here: it branches on `alepha.isTest()` and
 * generates migrations instead of pushing, so every test in this repo has
 * always exercised the fallback rather than the thing that runs in
 * development. That is precisely why a push that could not introspect its own
 * schema went unnoticed.
 */
class TestDrizzleKitProvider extends DrizzleKitProvider {
  public async testPush(provider: DatabaseProvider): Promise<void> {
    const kit = this.importDrizzleKit(this.payloadDialect(provider));
    return this.push(kit, this.getModels(provider), provider);
  }
}

/**
 * The shape the standard `users` entity declares: a multi-column unique index
 * whose second part is an expression, for case-insensitive uniqueness of a
 * name within a realm.
 */
const people = $entity({
  name: "people",
  schema: z.object({
    id: db.primaryKey(),
    realm: db.default(z.text(), "default"),
    username: z.text().optional(),
  }),
  indexes: [
    {
      expressions: (self, ctx) => [
        self.realm,
        ctx.caseInsensitive(self.username),
      ],
      unique: true,
      name: "people_realm_username_ci_idx",
    },
  ],
});

class App {
  people = $repository(people);
}

describe("push with a case-insensitive unique index", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "alepha-push-expr-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const boot = async () => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: `sqlite://${join(dir, "test.db")}`,
        DATABASE_SYNC: false,
      },
    });
    alepha.inject(App);
    const kit = alepha.inject(TestDrizzleKitProvider);
    await alepha.start();
    return { provider: alepha.inject(DatabaseProvider), kit };
  };

  /**
   * The second push is the one that matters. On a virgin database
   * introspection has no index to read, so the bug is invisible; it only
   * appears once the index it cannot model is actually there.
   *
   * drizzle-kit v1's sqlite introspection throws
   * `unexpected unique index '...' with expression value` for any MULTI-column
   * unique index carrying an expression (a single-column one is skipped
   * outright). Every Alepha app with the identity surface has exactly that
   * index on `users`, so `push` — and the dev-mode `DATABASE_SYNC` that runs
   * it — could never apply a schema change to a database that already
   * existed.
   */
  it("can push twice against the same database", async () => {
    const { provider, kit } = await boot();

    await kit.testPush(provider);
    await expect(kit.testPush(provider)).resolves.toBeUndefined();
  });

  /**
   * And the index still has to do its job: two spellings of one name in the
   * same realm must collide.
   */
  it("still enforces uniqueness case-insensitively within a realm", async () => {
    const { provider, kit } = await boot();
    await kit.testPush(provider);

    await provider.execute(
      sql`INSERT INTO people (id, realm, username) VALUES ('1', 'default', 'Admin')`,
    );

    await expect(
      provider.execute(
        sql`INSERT INTO people (id, realm, username) VALUES ('2', 'default', 'admin')`,
      ),
    ).rejects.toThrow();

    // ... but not across realms.
    await expect(
      provider.execute(
        sql`INSERT INTO people (id, realm, username) VALUES ('3', 'other', 'admin')`,
      ),
    ).resolves.toBeDefined();
  });

  /**
   * The upgrade path, which is the whole reason the index was renamed.
   *
   * drizzle-kit keys an index on its NAME, so changing only the expression
   * produced "no changes detected" and no migration - leaving the old
   * `LOWER()` index on disk in every database that already existed, still
   * unreadable, still breaking push. Renaming forces the `DROP INDEX` +
   * `CREATE UNIQUE INDEX` pair below, and that pair is what repairs them.
   */
  it("recovers a database still carrying the old expression index", async () => {
    const { provider, kit } = await boot();
    await kit.testPush(provider);

    // Put the pre-fix index back, exactly as older apps have it on disk.
    await provider.execute(sql.raw("DROP INDEX people_realm_username_ci_idx"));
    await provider.execute(
      sql.raw(
        'CREATE UNIQUE INDEX `people_realm_username_lower_idx` ON `people` (`realm`,LOWER("username"))',
      ),
    );

    await expect(kit.testPush(provider)).rejects.toThrow(/expression value/);

    // What the generated migration does, and nothing more.
    await provider.execute(
      sql.raw("DROP INDEX IF EXISTS `people_realm_username_lower_idx`"),
    );
    await provider.execute(
      sql.raw(
        'CREATE UNIQUE INDEX `people_realm_username_ci_idx` ON `people` (`realm`,"username" COLLATE NOCASE)',
      ),
    );

    await expect(kit.testPush(provider)).resolves.toBeUndefined();
  });

  /**
   * Why `eqInsensitive` had to move to `COLLATE NOCASE` on sqlite alongside
   * the index.
   *
   * sqlite narrows on an index column only when the predicate matches the key
   * it was built from. Both plans below name the index, so this is not the
   * difference between an index and a table scan - it is the difference
   * between seeking on `(realm, username)` and seeking on `realm` alone and
   * then filtering every row in that realm. On a single-realm deployment,
   * which is the default, "every row in that realm" is the whole table.
   */
  it("keeps the index usable from a case-insensitive lookup", async () => {
    const { provider, kit } = await boot();
    await kit.testPush(provider);

    const plan = async (predicate: string) => {
      const rows = await provider.execute(
        sql.raw(
          `EXPLAIN QUERY PLAN SELECT id FROM people WHERE realm = 'default' AND ${predicate}`,
        ),
      );
      return rows.map((row: any) => row.detail).join(" ");
    };

    expect(await plan("username = 'admin' COLLATE NOCASE")).toContain(
      "people_realm_username_ci_idx (realm=? AND username=?)",
    );
    expect(await plan("LOWER(username) = LOWER('admin')")).toContain(
      "people_realm_username_ci_idx (realm=?)",
    );
  });
});
