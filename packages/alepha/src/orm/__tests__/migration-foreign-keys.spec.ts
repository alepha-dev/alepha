import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "vitest";

/**
 * A generated table-rebuild must not take its children with it.
 *
 * SQLite ignores `PRAGMA foreign_keys` **inside a transaction**, and
 * drizzle wraps migrations in one — so the `PRAGMA foreign_keys=OFF`
 * drizzle-kit emits at the top of a rebuild is a no-op. Constraints stay
 * live, and because `DROP TABLE` performs an implicit `DELETE FROM`,
 * every `ON DELETE CASCADE` fires: rebuilding a parent silently empties
 * its children, with no error and a "Migration OK" log line.
 *
 * This cost a real app 2434 rows across five tables in a dry run —
 * capacity allocations, availability, activity tracking, planning phases
 * and skill allocations — from a schema change that touched none of them.
 *
 * The providers fix it by setting the pragma on the connection *before*
 * drizzle opens its transaction, which is the sequence SQLite's own
 * "Making Other Kinds Of Table Schema Changes" recipe prescribes. These
 * tests pin the underlying behaviour so the reasoning cannot be
 * refactored away by someone who assumes the in-SQL pragma works.
 */
describe("migration foreign key handling", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "alepha-fk-"));
    file = join(dir, "test.db");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** parent with 1 row, child with 5 rows cascading off it. */
  const seed = () => {
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec(
      "CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id) ON DELETE CASCADE)",
    );
    db.exec("INSERT INTO parent VALUES (1, 'p')");
    for (let i = 1; i <= 5; i++) {
      db.exec(`INSERT INTO child VALUES (${i}, 1)`);
    }
    return db;
  };

  /** The shape drizzle-kit emits for a SQLite table rebuild. */
  const rebuildParent = (db: DatabaseSync) => {
    db.exec("BEGIN");
    db.exec("CREATE TABLE __new_parent (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO __new_parent SELECT id, name FROM parent");
    db.exec("DROP TABLE parent");
    db.exec("ALTER TABLE __new_parent RENAME TO parent");
    db.exec("COMMIT");
  };

  const childCount = (db: DatabaseSync) =>
    (db.prepare("SELECT COUNT(*) AS n FROM child").get() as any).n;

  it("PRAGMA foreign_keys is ignored inside a transaction", ({ expect }) => {
    const db = seed();
    db.exec("BEGIN");
    db.exec("PRAGMA foreign_keys=OFF");
    // Still 1 — this is the whole reason the in-SQL pragma cannot be
    // trusted, and why the fix lives in the provider.
    expect((db.prepare("PRAGMA foreign_keys").get() as any).foreign_keys).toBe(
      1,
    );
    db.exec("ROLLBACK");
    db.close();
  });

  it("a parent rebuild destroys children when FKs are left enabled", ({
    expect,
  }) => {
    const db = seed();
    rebuildParent(db);
    // Documents the failure mode. If this ever returns 5, SQLite changed
    // its DROP TABLE semantics and the provider workaround can be revisited.
    expect(childCount(db)).toBe(0);
    db.close();
  });

  it("children survive when FKs are disabled before the transaction", ({
    expect,
  }) => {
    const db = seed();
    db.exec("PRAGMA foreign_keys=OFF"); // outside any transaction
    rebuildParent(db);
    db.exec("PRAGMA foreign_keys=ON");

    expect(childCount(db)).toBe(5);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("defer_foreign_keys does NOT prevent the cascade", ({ expect }) => {
    // Worth pinning: `defer_foreign_keys` is the obvious candidate because
    // it *does* apply inside a transaction — but it defers violation
    // checking, not the ON DELETE CASCADE action. It is not a fix.
    const db = seed();
    db.exec("BEGIN");
    db.exec("PRAGMA defer_foreign_keys=ON");
    db.exec("CREATE TABLE __new_parent (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO __new_parent SELECT id, name FROM parent");
    db.exec("DROP TABLE parent");
    db.exec("ALTER TABLE __new_parent RENAME TO parent");
    db.exec("COMMIT");

    expect(childCount(db)).toBe(0);
    db.close();
  });

  it("survives a multi-level cascade (grandchildren)", ({ expect }) => {
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    db.exec(
      "CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id) ON DELETE CASCADE)",
    );
    db.exec(
      "CREATE TABLE grandchild (id INTEGER PRIMARY KEY, cid INTEGER REFERENCES child(id) ON DELETE CASCADE)",
    );
    db.exec("INSERT INTO parent VALUES (1)");
    db.exec("INSERT INTO child VALUES (1, 1)");
    db.exec("INSERT INTO grandchild VALUES (1, 1)");

    db.exec("PRAGMA foreign_keys=OFF");
    // This fixture's parent has no `name` column, so rebuild it inline
    // rather than reusing the helper.
    db.exec("BEGIN");
    db.exec("CREATE TABLE __new_parent (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO __new_parent SELECT id FROM parent");
    db.exec("DROP TABLE parent");
    db.exec("ALTER TABLE __new_parent RENAME TO parent");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys=ON");

    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM grandchild").get() as any).n,
    ).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("foreign_key_check surfaces orphans left by a bad rebuild", ({
    expect,
  }) => {
    // The post-migration guard: a rebuild that drops a parent WITHOUT
    // carrying its rows over leaves orphans. With FKs disabled that is
    // silent, so the providers run this check and fail loudly.
    const db = seed();
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("BEGIN");
    db.exec("CREATE TABLE __new_parent (id INTEGER PRIMARY KEY, name TEXT)");
    // deliberately NOT copying the rows
    db.exec("DROP TABLE parent");
    db.exec("ALTER TABLE __new_parent RENAME TO parent");
    db.exec("COMMIT");

    expect(childCount(db)).toBe(5); // children kept…
    expect(db.prepare("PRAGMA foreign_key_check").all().length).toBe(5); // …but orphaned
    db.close();
  });
});
