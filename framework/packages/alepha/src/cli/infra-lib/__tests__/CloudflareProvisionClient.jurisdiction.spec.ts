import { describe, it } from "vitest";

import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";

/**
 * The request bodies that create a KV namespace and a queue (#Q3060).
 *
 * KV jurisdictions went GA on 2026-10-02 and Queues gained them on 2026-10-12,
 * each set in the create body and fixed for good once created. An environment
 * under a jurisdiction that left the field out stored its data globally.
 */
describe("CloudflareProvisionClient jurisdiction", () => {
  const capture = (jurisdiction?: "eu" | "us" | "fedramp") => {
    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    const original = globalThis.fetch;

    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? init.body : undefined;
      calls.push({
        url: String(url),
        method: init.method,
        body: body ? JSON.parse(body) : undefined,
      });
      // Every list answers empty, so every ensure creates.
      const result =
        init.method === "POST" ? { id: "new", queue_id: "new" } : [];
      return new Response(
        JSON.stringify({ success: true, result, errors: [] }),
      );
    }) as typeof globalThis.fetch;

    const api = new CloudflareProvisionClient({
      apiToken: "test-token",
      accountId: "acct-1",
      jurisdiction,
    });

    return { api, calls, restore: () => (globalThis.fetch = original) };
  };

  const posts = (calls: Array<{ method?: string; body?: any }>) =>
    calls.filter((call) => call.method === "POST").map((call) => call.body);

  for (const jurisdiction of ["eu", "us", "fedramp"] as const) {
    it(`sends ${jurisdiction} when it creates a KV namespace and a queue`, async ({
      expect,
    }) => {
      const { api, calls, restore } = capture(jurisdiction);
      try {
        await api.ensureKV("acme-production-" + jurisdiction);
        await api.ensureQueue("acme-production-" + jurisdiction);
        await api.ensureQueue(`acme-production-${jurisdiction}-dlq`);
      } finally {
        restore();
      }

      expect(posts(calls)).toEqual([
        { title: `acme-production-${jurisdiction}`, jurisdiction },
        { queue_name: `acme-production-${jurisdiction}`, jurisdiction },
        { queue_name: `acme-production-${jurisdiction}-dlq`, jurisdiction },
      ]);
    });
  }

  it("sends no jurisdiction field for a global environment", async ({
    expect,
  }) => {
    const { api, calls, restore } = capture();
    try {
      await api.ensureKV("acme-production");
      await api.ensureQueue("acme-production");
    } finally {
      restore();
    }

    expect(posts(calls)).toEqual([
      { title: "acme-production" },
      { queue_name: "acme-production" },
    ]);
  });
});
