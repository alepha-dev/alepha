import { describe, it } from "vitest";

import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";

/**
 * Provision without listing the account (#Q3386).
 *
 * A deploy used to list every D1 database (100 a page), every bucket and every
 * KV namespace to find the one it already had. A copy's previous deploy
 * records the ids, so each is checked by id; a bucket is checked by name. The
 * ids are hints: a resource deleted since must still be recreated.
 */
describe("CloudflareProvisionClient known resources", () => {
  const capture = (state: {
    d1?: Array<{ uuid: string; name: string }>;
    buckets?: string[];
    kv?: Array<{ id: string; title: string }>;
  }) => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ success: true, result, errors: [] }));
    const missing = () =>
      new Response(
        JSON.stringify({
          success: false,
          result: null,
          errors: [{ message: "not found" }],
        }),
        { status: 404 },
      );

    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = new URL(String(url)).pathname.replace(
        /^.*\/accounts\/acct-1/,
        "",
      );
      calls.push(`${method} ${path}`);
      const body =
        typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      let match: RegExpExecArray | null;
      if ((match = /^\/d1\/database\/([^/]+)$/.exec(path))) {
        const found = state.d1?.find((it) => it.uuid === match![1]);
        return found ? ok(found) : missing();
      }
      if (path === "/d1/database" && method === "GET")
        return ok(state.d1 ?? []);
      if (path === "/d1/database" && method === "POST") {
        return ok({ uuid: "created", name: body.name });
      }
      if ((match = /^\/r2\/buckets\/([^/]+)$/.exec(path))) {
        return state.buckets?.includes(match[1]!)
          ? ok({ name: match[1] })
          : missing();
      }
      if (path === "/r2/buckets" && method === "POST") return ok({});
      if ((match = /^\/storage\/kv\/namespaces\/([^/]+)$/.exec(path))) {
        const found = state.kv?.find((it) => it.id === match![1]);
        return found ? ok(found) : missing();
      }
      if (path === "/storage/kv/namespaces" && method === "GET") {
        return ok(state.kv ?? []);
      }
      if (path === "/storage/kv/namespaces" && method === "POST") {
        return ok({ id: "created", title: body.title });
      }
      return missing();
    }) as typeof globalThis.fetch;

    const api = new CloudflareProvisionClient({
      apiToken: "test-token",
      accountId: "acct-1",
    });
    return { api, calls, restore: () => (globalThis.fetch = original) };
  };

  it("finds a known database by its id, with no listing", async ({
    expect,
  }) => {
    const { api, calls, restore } = capture({
      d1: [{ uuid: "db-1", name: "acme-production" }],
    });
    try {
      const database = await api.ensureD1("acme-production", {
        knownId: "db-1",
      });
      expect(database.uuid).toBe("db-1");
    } finally {
      restore();
    }

    expect(calls).toEqual(["GET /d1/database/db-1"]);
  });

  it("recreates a database deleted since its id was recorded", async ({
    expect,
  }) => {
    const { api, calls, restore } = capture({ d1: [] });
    try {
      const database = await api.ensureD1("acme-production", {
        knownId: "db-gone",
      });
      expect(database.uuid).toBe("created");
    } finally {
      restore();
    }

    expect(calls).toEqual([
      "GET /d1/database/db-gone",
      "GET /d1/database",
      "POST /d1/database",
    ]);
  });

  it("does not take an id that now names another database", async ({
    expect,
  }) => {
    const { api, restore } = capture({
      d1: [
        { uuid: "db-1", name: "someone-else" },
        { uuid: "db-2", name: "acme-production" },
      ],
    });
    try {
      const database = await api.ensureD1("acme-production", {
        knownId: "db-1",
      });
      expect(database.uuid).toBe("db-2");
    } finally {
      restore();
    }
  });

  it("checks a bucket by its name, and creates it only when absent", async ({
    expect,
  }) => {
    const present = capture({ buckets: ["acme-production"] });
    try {
      await present.api.ensureR2("acme-production");
    } finally {
      present.restore();
    }
    expect(present.calls).toEqual(["GET /r2/buckets/acme-production"]);

    const absent = capture({ buckets: [] });
    try {
      await absent.api.ensureR2("acme-production");
    } finally {
      absent.restore();
    }
    expect(absent.calls).toEqual([
      "GET /r2/buckets/acme-production",
      "POST /r2/buckets",
    ]);
  });

  it("finds a known KV namespace by its id, and recreates a deleted one", async ({
    expect,
  }) => {
    const known = capture({ kv: [{ id: "kv-1", title: "acme-production" }] });
    try {
      expect(
        (await known.api.ensureKV("acme-production", { knownId: "kv-1" })).id,
      ).toBe("kv-1");
    } finally {
      known.restore();
    }
    expect(known.calls).toEqual(["GET /storage/kv/namespaces/kv-1"]);

    const gone = capture({ kv: [] });
    try {
      expect(
        (await gone.api.ensureKV("acme-production", { knownId: "kv-1" })).id,
      ).toBe("created");
    } finally {
      gone.restore();
    }
    expect(gone.calls.at(-1)).toBe("POST /storage/kv/namespaces");
  });
});
