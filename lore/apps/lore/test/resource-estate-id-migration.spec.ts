import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/** Resolved from this file, for the reason `sigil-source-url-migration.spec.ts` gives. */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The back-fill of `app_instances.resource_estate_id`, which is what lets the
 * Backups tab drive the instance a copy runs as on its estate.
 *
 * ⚠️ Applied for real against seeded rows: a name two copies share must vouch
 * for neither, or one project's tab could reach another project's instance.
 */
describe("the resource estate back-fill migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  const found = migrations.find((name) => name.endsWith("resource_estate_id"));

  it("vouches only for names a single copy holds", ({ expect }) => {
    expect(found).toBeDefined();
    const db: any = new DatabaseSync(":memory:");
    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };
    for (const dir of migrations.slice(0, migrations.indexOf(found!))) {
      apply(dir);
    }

    // Seeded without parents: the statement under test reads no foreign key.
    db.exec("PRAGMA foreign_keys = OFF");
    const E = "00000000-0000-0000-0000-00000000000e";
    const F = "00000000-0000-0000-0000-00000000000f";
    const insert = db.prepare(
      "INSERT INTO app_instances (id, project_id, app, env, estate_id, resource_name) VALUES (?, ?, 'app', 'production', ?, ?)",
    );
    insert.run("alone", 1, E, "acme-app-production");
    insert.run("unnamed", 2, E, null);
    insert.run("homeless", 3, null, "solo-app-production");
    // Two copies on one estate under the same name.
    insert.run("twin-a", 4, E, "shared-app-production");
    insert.run("twin-b", 5, E, "shared-app-production");
    // One copy moved to F, still named as on E where another now runs.
    insert.run("moved", 6, F, "slug-app-production");
    insert.run("taker", 7, E, "slug-app-production");

    apply(found!);

    const estateOf = (id: string) =>
      db
        .prepare(
          "SELECT resource_estate_id AS e FROM app_instances WHERE id = ?",
        )
        .get(id).e;
    expect(estateOf("alone")).toBe(E);
    for (const id of [
      "unnamed",
      "homeless",
      "twin-a",
      "twin-b",
      "moved",
      "taker",
    ]) {
      expect(estateOf(id)).toBeNull();
    }
    db.close();
  });
});
