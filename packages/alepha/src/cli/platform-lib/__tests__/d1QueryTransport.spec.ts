import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { CloudflareApi } from "../services/CloudflareApi.ts";

/**
 * The transport half of #1514: what actually goes over the wire when a
 * migration is applied.
 *
 * ⚠️ **`wrangler d1 execute --remote` semantics, never `d1 migrations apply`
 * semantics.** The second wraps each migration in a transaction, SQLite ignores
 * `PRAGMA foreign_keys` inside one, and drizzle's generated table rebuilds
 * depend on that pragma to keep `DROP TABLE` from cascading. It cost 2434 rows
 * across five tables in one production deploy.
 *
 * `d1MigrationsApply.spec.ts` covers discovery, ordering and bookkeeping. This
 * file covers the request: the endpoint, and the fact that a whole
 * multi-statement file goes up as ONE `sql` string rather than being split.
 */
describe("the D1 query transport", () => {
  const capture = (result: unknown = []) => {
    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    const original = globalThis.fetch;

    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      // `RequestInit["body"]` is a union wide enough to include a stream; the
      // client only ever sends a JSON string, so narrowing is the honest read.
      const body = typeof init.body === "string" ? init.body : undefined;
      calls.push({
        url: String(url),
        method: init.method,
        body: body ? JSON.parse(body) : undefined,
      });
      return new Response(
        JSON.stringify({ success: true, result, errors: [] }),
      );
    }) as typeof globalThis.fetch;

    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const api = alepha.inject(CloudflareApi);
    // The token comes from `wrangler auth token`, which is a shell-out and not
    // what this file is about.
    Object.assign(api as unknown as Record<string, unknown>, {
      token: "test-token",
      accountId: "acct-1",
    });

    return { api, calls, restore: () => (globalThis.fetch = original) };
  };

  it("posts to the account's database query endpoint", async ({ expect }) => {
    const { api, calls, restore } = capture();
    try {
      await api.d1Query("db-uuid-1", "SELECT 1;");
    } finally {
      restore();
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database/db-uuid-1/query",
    );
    expect(calls[0].method).toBe("POST");
  });

  it("sends a whole multi-statement migration as one sql string", async ({
    expect,
  }) => {
    // A real drizzle table rebuild: the pragma and the `DROP TABLE` it exists
    // to protect, separated by a statement breakpoint. Splitting this into one
    // request per statement would end the pragma's scope before the drop, which
    // is `migrations apply`'s bug reached by another route.
    const migration = [
      "PRAGMA foreign_keys=OFF;",
      "--> statement-breakpoint",
      "CREATE TABLE `__new_parent` (`id` integer PRIMARY KEY);",
      "--> statement-breakpoint",
      "INSERT INTO `__new_parent` SELECT * FROM `parent`;",
      "--> statement-breakpoint",
      "DROP TABLE `parent`;",
      "--> statement-breakpoint",
      "ALTER TABLE `__new_parent` RENAME TO `parent`;",
      "--> statement-breakpoint",
      "PRAGMA foreign_keys=ON;",
    ].join("\n");

    const { api, calls, restore } = capture();
    try {
      await api.d1Query("db-uuid-1", migration);
    } finally {
      restore();
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ sql: migration });
    // Nothing wrapped around it, in either direction.
    expect(/\bBEGIN\b/i.test(calls[0].body.sql)).toBe(false);
    expect(/\bCOMMIT\b/i.test(calls[0].body.sql)).toBe(false);
  });

  it("reads the applied names out of the API's own JSON", async ({
    expect,
  }) => {
    // The shell path scraped `--json` output with /"name":\s*"([^"]+)"/g,
    // which would have matched a `name` column of any other table that
    // happened to share the output.
    const { api, calls, restore } = capture([
      { success: true, results: [{ name: "0001_init.sql" }] },
    ]);
    let answer: Array<{ results?: Array<Record<string, any>> }>;
    try {
      answer = await api.d1Query(
        "db-uuid-1",
        "SELECT name FROM d1_migrations;",
      );
    } finally {
      restore();
    }

    expect(calls).toHaveLength(1);
    expect(answer[0]?.results?.[0]?.name).toBe("0001_init.sql");
  });

  it("names the database it could not find, and the ones it could", async ({
    expect,
  }) => {
    const { api, restore } = capture([
      { uuid: "u1", name: "my-app-staging" },
      { uuid: "u2", name: "my-app-production" },
    ]);
    try {
      await expect(api.resolveD1Id("my-app-preview")).rejects.toThrowError(
        /No D1 database named 'my-app-preview'.*my-app-production, my-app-staging/s,
      );
      await expect(api.resolveD1Id("my-app-production")).resolves.toBe("u2");
    } finally {
      restore();
    }
  });
});
