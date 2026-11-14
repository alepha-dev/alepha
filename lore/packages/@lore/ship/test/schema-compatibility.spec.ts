import { Alepha } from "alepha";
import { describe, it } from "vitest";

// By file, not through the barrel: evaluating `../src/api/index.ts` boots the
// whole module, and these two are pure enough to test alone.
import { ArtifactSchemaStore } from "../src/api/services/ArtifactSchemaStore.ts";
import { SchemaCompatibility } from "../src/api/services/SchemaCompatibility.ts";

/**
 * A drizzle-kit 1 snapshot, as `migrations/<dialect>/<folder>/snapshot.json`
 * holds it, from a terse description: `{ users: { id: "integer!", email:
 * "text" } }`, where `!` is NOT NULL and `=` a default.
 */
const snapshot = (
  tables: Record<string, Record<string, string>>,
  extra: Array<Record<string, unknown>> = [],
) => ({
  version: "7",
  dialect: "sqlite",
  ddl: [
    ...Object.entries(tables).flatMap(([table, columns]) => [
      { name: table, entityType: "tables" },
      ...Object.entries(columns).map(([name, spec]) => ({
        table,
        name,
        type: spec.replace(/[!=]/g, ""),
        notNull: spec.includes("!"),
        autoincrement: false,
        default: spec.includes("=") ? "0" : null,
        generated: null,
        entityType: "columns",
      })),
    ]),
    ...extra,
  ],
  renames: [],
});

describe("SchemaCompatibility (#Q3542)", () => {
  const compatibility = new SchemaCompatibility();
  const compare = (
    older: ReturnType<typeof snapshot>,
    live: ReturnType<typeof snapshot>,
  ) =>
    compatibility.compare(
      compatibility.reduce(older)!,
      compatibility.reduce(live)!,
    );

  const base = { users: { id: "integer!", email: "text!" } };

  it("finds nothing when the live schema only adds", ({ expect }) => {
    const changes = compare(
      snapshot(base),
      snapshot(
        {
          users: { ...base.users, nickname: "text", score: "integer!=" },
          sessions: { id: "text!" },
        },
        [
          {
            table: "users",
            name: "users_email_idx",
            columns: [{ value: "email", isExpression: false }],
            isUnique: false,
            entityType: "indexes",
          },
        ],
      ),
    );

    expect(changes).toEqual([]);
  });

  it("breaks on a dropped table or column, which is also what a rename is", ({
    expect,
  }) => {
    const changes = compare(
      snapshot({ ...base, sessions: { id: "text!" } }),
      snapshot({ users: { id: "integer!", mail: "text!" } }),
    );

    expect(changes).toEqual([
      { severity: "breaks", change: "users.email dropped" },
      {
        severity: "breaks",
        change: "users.mail added NOT NULL with no default",
      },
      { severity: "breaks", change: "sessions dropped" },
    ]);
  });

  it("calls a type change, a tightened NOT NULL and a new constraint risky", ({
    expect,
  }) => {
    const changes = compare(
      snapshot({ users: { id: "integer!", email: "text", age: "integer" } }),
      snapshot({ users: { id: "integer!", email: "text!", age: "text" } }, [
        {
          table: "users",
          name: "users_email_unique",
          columns: [{ value: "email", isExpression: false }],
          isUnique: true,
          where: null,
          entityType: "indexes",
        },
        {
          table: "users",
          name: "users_age_check",
          value: "age > 0",
          entityType: "checks",
        },
      ]),
    );

    expect(changes).toEqual([
      { severity: "risky", change: "users.email now NOT NULL" },
      { severity: "risky", change: "users.age integer -> text" },
      { severity: "risky", change: "check users age > 0 added" },
      { severity: "risky", change: "unique index users (email) added" },
    ]);
  });

  it("ignores a constraint on a table the older build never had", ({
    expect,
  }) => {
    const changes = compare(
      snapshot(base),
      snapshot({ ...base, posts: { id: "integer!", user_id: "integer" } }, [
        {
          table: "posts",
          name: "fk_posts_user",
          columns: ["user_id"],
          tableTo: "users",
          columnsTo: ["id"],
          entityType: "fks",
        },
      ]),
    );

    expect(changes).toEqual([]);
  });

  it("reduces nothing it does not recognise as a snapshot", ({ expect }) => {
    expect(compatibility.reduce({ version: "5", tables: {} })).toBeUndefined();
    expect(compatibility.reduce(null)).toBeUndefined();
  });
});

describe("ArtifactSchemaStore (#Q3542)", () => {
  const sha256 = "a".repeat(64);
  const file = (body: unknown) =>
    new File([typeof body === "string" ? body : JSON.stringify(body)], "s");

  it("stores the reduction of what a push sent, per project", async ({
    expect,
  }) => {
    const store = Alepha.create().inject(ArtifactSchemaStore);
    await store.storePushed(
      "artifacts",
      7,
      sha256,
      file({
        version: 1,
        dialects: { sqlite: snapshot({ users: { id: "integer!" } }) },
      }),
    );

    const read = await store.read("artifacts", 7, sha256);
    expect(read?.dialects.sqlite.tables.users.id).toEqual({
      type: "integer",
      notNull: true,
      filled: false,
    });
    expect(await store.read("artifacts", 8, sha256)).toBeUndefined();
  });

  it("drops a part it cannot read instead of failing the push", async ({
    expect,
  }) => {
    const store = Alepha.create().inject(ArtifactSchemaStore);
    await store.storePushed("artifacts", 7, sha256, file("{ not json"));
    await store.storePushed("artifacts", 7, sha256, file({ version: 2 }));

    expect(await store.read("artifacts", 7, sha256)).toBeUndefined();
  });
});
