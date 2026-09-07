import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { CloudflareApi } from "../services/CloudflareApi.ts";

/**
 * The transport half of #1514: what actually goes over the wire when a
 * migration is applied.
 *
 * ⚠️ **There are TWO endpoints and they are not interchangeable.** Measured
 * 2026-09-07 against a real D1, one drizzle table rebuild, one five-row
 * CASCADE child:
 *
 * | endpoint | child rows after |
 * | --- | --- |
 * | `POST .../query` | **0 of 5** |
 * | the `.../import` flow | **5 of 5** |
 *
 * So `/query` voids `PRAGMA foreign_keys=OFF` exactly as
 * `wrangler d1 migrations apply` does - the thing that destroyed 2434 rows
 * across five tables. `d1Query` is for the bookkeeping (what `--command`
 * uses); `d1Import` is for a migration file (what `--file` uses).
 *
 * `d1MigrationsApply.spec.ts` covers discovery, ordering and which of the two
 * each statement takes. This file covers the requests themselves.
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

  it("uploads a migration file and polls the import to completion", async ({
    expect,
  }) => {
    // wrangler's own `--file` flow, step for step: init with the md5, upload
    // if D1 does not already hold it, ingest, poll. The `etag` the upload
    // answers has to match, or the bytes about to be ingested are not the
    // bytes we meant to run.
    const { api, calls, restore } = capture({});
    let uploadedEtag: string | undefined;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const target = String(url);
      if (target.startsWith("https://upload.example/")) {
        uploadedEtag = target.split("/").pop();
        return new Response(null, {
          status: 200,
          headers: { etag: `"${uploadedEtag}"` },
        });
      }
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      calls.push({ url: target, method: init.method, body });
      const result =
        body.action === "init"
          ? { upload_url: `https://upload.example/${body.etag}`, filename: "f" }
          : body.action === "ingest"
            ? { status: "importing", at_bookmark: "b1" }
            : { status: "complete" };
      return new Response(
        JSON.stringify({ success: true, result, errors: [] }),
      );
    }) as typeof globalThis.fetch;

    try {
      await api.d1Import("db-uuid-1", "PRAGMA foreign_keys=OFF;");
    } finally {
      globalThis.fetch = original;
      restore();
    }

    expect(calls.map((it) => it.body.action)).toEqual([
      "init",
      "ingest",
      "poll",
    ]);
    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database/db-uuid-1/import",
    );
    expect(uploadedEtag).toBe(calls[0].body.etag);
  });

  it("refuses when the uploaded bytes are not the bytes it meant to run", async ({
    expect,
  }) => {
    const { api, restore } = capture({});
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (String(url).startsWith("https://upload.example/")) {
        return new Response(null, {
          status: 200,
          headers: { etag: '"not-the-same"' },
        });
      }
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      return new Response(
        JSON.stringify({
          success: true,
          result:
            body.action === "init"
              ? { upload_url: "https://upload.example/x", filename: "f" }
              : { status: "complete" },
          errors: [],
        }),
      );
    }) as typeof globalThis.fetch;

    try {
      await expect(api.d1Import("db-uuid-1", "SELECT 1;")).rejects.toThrowError(
        /did not upload intact/,
      );
    } finally {
      globalThis.fetch = original;
      restore();
    }
  });

  it("treats an init that answers complete as nothing left to do", async ({
    expect,
  }) => {
    // ⚠️ Measured: D1 keys an import by md5, so a file it has already ingested
    // comes back `complete` from `init` with no `filename` - and an `ingest`
    // after that answers "Invalid property: filename => Required", which reads
    // as a malformed request rather than as "there was nothing to do".
    const { api, restore } = capture({});
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      seen.push(String(body.action));
      return new Response(
        JSON.stringify({
          success: true,
          result: { status: "complete" },
          errors: [],
        }),
      );
    }) as typeof globalThis.fetch;

    try {
      await api.d1Import("db-uuid-1", "SELECT 1;");
    } finally {
      globalThis.fetch = original;
      restore();
    }

    expect(seen).toEqual(["init"]);
  });

  it("sends a whole multi-statement bookkeeping query as one sql string", async ({
    expect,
  }) => {
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
