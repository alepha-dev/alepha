import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { Alepha } from "alepha";
import { AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { folioRevisions } from "../src/api/entities/folioRevisions.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * #Q2491: the newest revision of a folio holds no copy of the body, which
 * would be byte-identical to `folios.content`. What it must keep is the
 * history an agent recovers a folio from: every revision still reads the
 * body it documents, through the History endpoint, `folio_history` and a
 * revert, however the rows store it.
 */
class Rows {
  revisions = $repository(folioRevisions);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha
    .with(AlephaOrm)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers)
    .with(LoreApi);
  const rows = alepha.inject(Rows);
  await alepha.start();

  const account = await alepha
    .inject(RealmProvider)
    .userRepository()
    .create({ username: "historian" });
  const user: UserAccountToken = { id: account.id, roles: ["user"] };
  const project = await alepha
    .inject(ProjectController)
    .createProject({ body: { title: "History" } }, { user });

  return {
    alepha,
    rows,
    user,
    projectId: project.id,
    folios: alepha.inject(FolioController),
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const stored = (ctx: Ctx, folioId: string) =>
  ctx.rows.revisions.findMany({
    where: { folioId: { eq: folioId } },
    orderBy: [{ column: "at", direction: "desc" }],
  });

const history = (ctx: Ctx, folioId: string) =>
  ctx.folios.listHistory({ params: { id: folioId } }, { user: ctx.user });

const edit = async (ctx: Ctx, folioId: string, content: string) => {
  // Past the coalescing window, so each edit is its own revision.
  await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");
  await ctx.folios.update(
    { params: { id: folioId }, body: { content } },
    { user: ctx.user },
  );
};

describe("folio revisions store no copy of the live body", () => {
  it("writes the head empty and reads the live content for it", async ({
    expect,
  }) => {
    const ctx = await setup();
    const folio = await ctx.folios.create(
      { body: { projectId: ctx.projectId, title: "T", content: "v1" } },
      { user: ctx.user },
    );

    const [head] = await stored(ctx, folio.id);
    expect(head.snapshotIsLive).toBe(true);
    expect(head.contentSnapshot).toBe("");
    expect((await history(ctx, folio.id))[0]?.contentSnapshot).toBe("v1");
  });

  it("fills the old head in with the body it documented on the next edit", async ({
    expect,
  }) => {
    const ctx = await setup();
    const folio = await ctx.folios.create(
      { body: { projectId: ctx.projectId, title: "T", content: "v1" } },
      { user: ctx.user },
    );
    await edit(ctx, folio.id, "v2");
    await edit(ctx, folio.id, "v3");

    const rows = await stored(ctx, folio.id);
    expect(
      rows.map((row) => [row.snapshotIsLive, row.contentSnapshot]),
    ).toEqual([
      [true, ""],
      [false, "v2"],
      [false, "v1"],
    ]);
    // One live row at most, whatever happened before.
    expect(rows.filter((row) => row.snapshotIsLive)).toHaveLength(1);

    const read = await history(ctx, folio.id);
    expect(read.map((row) => row.contentSnapshot)).toEqual(["v3", "v2", "v1"]);
    // The diff against the older revision still sees both bodies.
    expect(read[0]?.linesAdded).toBe(1);
    expect(read[0]?.linesRemoved).toBe(1);
  });

  it("keeps the head live while a writing session folds into it", async ({
    expect,
  }) => {
    const ctx = await setup();
    const folio = await ctx.folios.create(
      { body: { projectId: ctx.projectId, title: "T", content: "v1" } },
      { user: ctx.user },
    );
    await edit(ctx, folio.id, "v2");
    // Inside the window: folds into the head rather than inserting.
    await ctx.folios.update(
      { params: { id: folio.id }, body: { content: "v2 and more" } },
      { user: ctx.user },
    );

    const rows = await stored(ctx, folio.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.snapshotIsLive).toBe(true);
    expect(
      (await history(ctx, folio.id)).map((r) => r.contentSnapshot),
    ).toEqual(["v2 and more", "v1"]);
  });

  it("reverts to an old revision, and to the head, with the right body", async ({
    expect,
  }) => {
    const ctx = await setup();
    const folio = await ctx.folios.create(
      { body: { projectId: ctx.projectId, title: "T", content: "v1" } },
      { user: ctx.user },
    );
    await edit(ctx, folio.id, "v2");
    const [head, first] = await history(ctx, folio.id);

    const back = await ctx.folios.revertHistory(
      { params: { id: folio.id, revisionId: first!.id } },
      { user: ctx.user },
    );
    expect(back.content).toBe("v1");
    expect(
      (await history(ctx, folio.id)).map((r) => r.contentSnapshot),
    ).toEqual(["v1", "v2", "v1"]);

    // The revision that was the head is a full row now, so reverting to it
    // restores v2 rather than whatever is live.
    const again = await ctx.folios.revertHistory(
      { params: { id: folio.id, revisionId: head!.id } },
      { user: ctx.user },
    );
    expect(again.content).toBe("v2");
  });
});

const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations/sqlite");

describe("folio revision live-head migration", () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();
  const sqlOf = (name: string) =>
    readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
  const target = migrations.find((name) =>
    sqlOf(name).includes("ADD `snapshot_is_live`"),
  );

  it("adds a column and never drops a table", ({ expect }) => {
    expect(target).toBeDefined();
    const statements = sqlOf(target!)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/DROP TABLE/i);
  });

  it("empties only a head that equals the live body", ({ expect }) => {
    // better-sqlite3 through `createRequire`, as in `migration-safety.spec.ts`.
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const apply = (dir: string) => {
      for (const raw of sqlOf(dir).split("--> statement-breakpoint")) {
        const statement = raw.trim();
        if (statement) db.exec(statement);
      }
    };
    for (const dir of migrations.slice(0, migrations.indexOf(target!))) {
      apply(dir);
    }

    const owner = "00000000-0000-0000-0000-000000000001";
    db.prepare("INSERT INTO users (id) VALUES (?)").run(owner);
    db.prepare(
      "INSERT INTO projects (id, title, created_by) VALUES (1, 'P', ?)",
    ).run(owner);
    const folio = db.prepare(
      "INSERT INTO folios (id, project_id, short_id, title, content) VALUES (?, 1, ?, 'T', ?)",
    );
    const same = "00000000-0000-4000-8000-00000000000a";
    const drifted = "00000000-0000-4000-8000-00000000000b";
    folio.run(same, 1, "live body");
    folio.run(drifted, 2, "edited elsewhere");

    const revision = db.prepare(
      "INSERT INTO folio_revisions (id, folio_id, at, action, content_snapshot, title_snapshot) VALUES (?, ?, ?, 'edit', ?, 'T')",
    );
    revision.run("r1", same, "2026-09-01T00:00:00.000Z", "old body");
    revision.run("r2", same, "2026-09-02T00:00:00.000Z", "live body");
    revision.run(
      "r3",
      drifted,
      "2026-09-02T00:00:00.000Z",
      "not the live body",
    );

    apply(target!);

    const row = (id: string) =>
      db
        .prepare(
          "SELECT content_snapshot AS content, snapshot_is_live AS live FROM folio_revisions WHERE id = ?",
        )
        .get(id);
    expect(row("r2")).toEqual({ content: "", live: 1 });
    expect(row("r1")).toEqual({ content: "old body", live: 0 });
    // A head that differs from the live body keeps it: nothing is lost.
    expect(row("r3")).toEqual({ content: "not the live body", live: 0 });
    db.close();
  });
});
