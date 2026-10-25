import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaOrm } from "../core/index.ts";
import { NodeSqliteProvider } from "../core/providers/drivers/NodeSqliteProvider.ts";

/**
 * The database path a SQLite app resolves when `DATABASE_URL` says nothing.
 *
 * Production used to silently fall back to `node_modules/.alepha/sqlite.db` —
 * the same file `alepha dev` pushes its schema into, with an empty migrations
 * journal. A production boot then replayed the baseline onto existing tables
 * and died on `table 'alepha_sequences' already exists`.
 */
describe("NodeSqliteProvider#url", () => {
  const provider = (env: Record<string, string>) =>
    Alepha.create({ env }).with(AlephaOrm).inject(NodeSqliteProvider) as any;

  it("should use an in-memory database under test", ({ expect }) => {
    expect(provider({ DATABASE_URL: "" }).url).toBe(":memory:");
  });

  it("should fall back to the scratch path in development", ({ expect }) => {
    expect(
      provider({ DATABASE_URL: "", NODE_ENV: "development", VITEST: "" }).url,
    ).toBe("node_modules/.alepha/sqlite.db");
  });

  it("should refuse the scratch path in production", ({ expect }) => {
    expect(
      () =>
        provider({ DATABASE_URL: "", NODE_ENV: "production", VITEST: "" }).url,
    ).toThrow(/DATABASE_URL is required in production/);
  });

  it("should accept an explicit DATABASE_URL in production", ({ expect }) => {
    expect(
      provider({
        DATABASE_URL: "/var/lib/myapp/db.sqlite",
        NODE_ENV: "production",
        VITEST: "",
      }).url,
    ).toBe("/var/lib/myapp/db.sqlite");
  });

  /**
   * `alepha db migrations apply` boots the app with `NODE_ENV=production` so
   * migrations run through the file-based path instead of the dev push. The
   * guard must not read that as a deploy, or the command becomes unusable in
   * development — where the scratch file is exactly the database meant.
   */
  it("should allow the scratch path for a migration run", ({ expect }) => {
    expect(
      provider({
        DATABASE_URL: "",
        NODE_ENV: "production",
        VITEST: "",
        MIGRATE: "true",
      }).url,
    ).toBe("node_modules/.alepha/sqlite.db");
  });

  it("should allow the scratch path under MODE=MIGRATE too", ({ expect }) => {
    expect(
      provider({
        DATABASE_URL: "",
        NODE_ENV: "production",
        VITEST: "",
        MODE: "MIGRATE",
      }).url,
    ).toBe("node_modules/.alepha/sqlite.db");
  });
});
