import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

/** Resolved from this file, for the reason `sigil-source-url-migration.spec.ts` gives. */
const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

/**
 * The rename of a Bay copy to the name its machine runs it under (#Q3285).
 *
 * ⚠️ Applied for real against seeded rows: a copy renamed by mistake sends its
 * next deploy, its backups and its removal to an instance that is not its own.
 */
describe("the Bay copy machine name migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();

  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  const found = migrations.find((name) =>
    name.endsWith("bay_copy_machine_names"),
  );

  it("renames only a lone copy still on the Bay it is named on", ({
    expect,
  }) => {
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
    const BAY = "00000000-0000-0000-0000-00000000000b";
    const BAY2 = "00000000-0000-0000-0000-0000000000b2";
    const CLOUD = "00000000-0000-0000-0000-00000000000c";
    const estate = db.prepare(
      "INSERT INTO estates (id, owner_user_id, type, slug) VALUES (?, 'owner', ?, ?)",
    );
    estate.run(BAY, "bay", "bay-one");
    estate.run(BAY2, "bay", "bay-two");
    estate.run(CLOUD, "cloudflare", "cloud");

    const insert = db.prepare(
      "INSERT INTO app_instances (id, project_id, app, env, estate_id, resource_estate_id, resource_name, stack_environment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // One project per row: (project, app, env) is unique.
    let project = 0;
    const seed = (id: string, ...rest: (string | null)[]) =>
      insert.run(id, ++project, ...rest);
    // Deployed on its Bay under a project segment the machine never received.
    seed(
      "deployed",
      "api",
      "production",
      BAY,
      BAY,
      "acme-api-production",
      null,
    );
    // Named by a deploy that never came back done.
    seed("queued", "web", "staging", BAY, null, "acme-web-staging", null);
    // An app whose name holds the LIKE wildcards.
    seed("wild", "a_b%", "production", BAY, BAY, "acme-a_b%-production", null);
    // Already bare: a project with no slug.
    seed("bare", "site", "production", BAY, BAY, "site-production", null);
    seed("unnamed", "new", "production", BAY, null, null, null);
    // On Cloudflare the name is a Worker's.
    seed(
      "worker",
      "api",
      "production",
      CLOUD,
      CLOUD,
      "acme-api-production",
      null,
    );
    // Moved from the Bay to Cloudflare, and the other way round.
    seed(
      "left",
      "shop",
      "production",
      CLOUD,
      BAY,
      "acme-shop-production",
      null,
    );
    seed("came", "crm", "production", BAY, CLOUD, "acme-crm-production", null);
    // A stack member is named after its stack and service.
    seed(
      "member",
      "docs",
      "production",
      BAY,
      BAY,
      "acme-docs-production",
      "env-1",
    );
    // Two projects with one app and environment on one machine.
    seed(
      "twin-a",
      "blog",
      "production",
      BAY2,
      BAY2,
      "acme-blog-production",
      null,
    );
    seed(
      "twin-b",
      "blog",
      "production",
      BAY2,
      BAY2,
      "other-blog-production",
      null,
    );
    // One copy still running where another is now pointed.
    seed(
      "stayed",
      "mail",
      "production",
      CLOUD,
      BAY2,
      "acme-mail-production",
      null,
    );
    seed(
      "taker",
      "mail",
      "production",
      BAY2,
      BAY2,
      "other-mail-production",
      null,
    );
    // Renamed since its first deploy: the name no longer ends with its pair.
    seed(
      "renamed",
      "newname",
      "production",
      BAY,
      BAY,
      "acme-oldname-production",
      null,
    );

    apply(found!);

    const nameOf = (id: string) =>
      db
        .prepare("SELECT resource_name AS n FROM app_instances WHERE id = ?")
        .get(id).n;
    expect(nameOf("deployed")).toBe("api-production");
    expect(nameOf("queued")).toBe("web-staging");
    expect(nameOf("wild")).toBe("a_b%-production");

    expect(nameOf("bare")).toBe("site-production");
    expect(nameOf("unnamed")).toBeNull();
    expect(nameOf("worker")).toBe("acme-api-production");
    expect(nameOf("left")).toBe("acme-shop-production");
    expect(nameOf("came")).toBe("acme-crm-production");
    expect(nameOf("member")).toBe("acme-docs-production");
    expect(nameOf("twin-a")).toBe("acme-blog-production");
    expect(nameOf("twin-b")).toBe("other-blog-production");
    expect(nameOf("stayed")).toBe("acme-mail-production");
    expect(nameOf("taker")).toBe("other-mail-production");
    expect(nameOf("renamed")).toBe("acme-oldname-production");
    db.close();
  });
});
