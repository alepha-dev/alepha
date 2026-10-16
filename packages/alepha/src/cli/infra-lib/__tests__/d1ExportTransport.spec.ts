import { describe, it } from "vitest";

import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";

/**
 * `CloudflareProvisionClient.d1Export`, the transport behind
 * `alepha infra db export` since it stopped running `wrangler d1 export`
 * (#Q2616): D1's polling export, then the download from the signed URL.
 */
describe("the D1 export transport", () => {
  /**
   * Answers each export poll from `steps` in order, and the signed URL with
   * `dump`. Records every request.
   */
  const serve = (
    steps: unknown[],
    dump = "-- dump\n",
    downloadStatus = 200,
  ) => {
    const calls: Array<{ url: string; method?: string; body?: any }> = [];
    const original = globalThis.fetch;
    let step = 0;

    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? init.body : undefined;
      calls.push({
        url: String(url),
        method: init.method,
        body: body ? JSON.parse(body) : undefined,
      });
      if (String(url).startsWith("https://signed.example/")) {
        return new Response(dump, { status: downloadStatus });
      }
      const result = steps[Math.min(step++, steps.length - 1)];
      return new Response(
        JSON.stringify({ success: true, result, errors: [] }),
      );
    }) as typeof globalThis.fetch;

    const api = new CloudflareProvisionClient({
      apiToken: "test-token",
      accountId: "acct-1",
    });

    return { api, calls, restore: () => (globalThis.fetch = original) };
  };

  it("polls with the last bookmark until complete, then downloads the dump", async ({
    expect,
  }) => {
    const { api, calls, restore } = serve([
      { status: "active", at_bookmark: "b1" },
      { status: "active", at_bookmark: "b2" },
      {
        status: "complete",
        result: { signed_url: "https://signed.example/dump.sql" },
      },
    ]);
    let dump: Uint8Array;
    try {
      dump = await api.d1Export("db-uuid-1");
    } finally {
      restore();
    }

    expect(new TextDecoder().decode(dump)).toBe("-- dump\n");
    const polls = calls.filter((it) => it.url.endsWith("/export"));
    expect(polls.map((it) => it.url)).toEqual(
      Array(3).fill(
        "https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database/db-uuid-1/export",
      ),
    );
    expect(polls.map((it) => it.body.output_format)).toEqual(
      Array(3).fill("polling"),
    );
    expect(polls.map((it) => it.body.current_bookmark)).toEqual([
      undefined,
      "b1",
      "b2",
    ]);
    expect(calls.at(-1)!.url).toBe("https://signed.example/dump.sql");
  });

  it("throws D1's reason when the export fails", async ({ expect }) => {
    const { api, restore } = serve([
      { status: "active", at_bookmark: "b1" },
      { status: "error", error: "database is busy" },
    ]);
    try {
      await expect(api.d1Export("db-uuid-1")).rejects.toThrow(
        /could not export the database: database is busy/,
      );
    } finally {
      restore();
    }
  });

  it("throws when the signed URL does not download", async ({ expect }) => {
    const { api, restore } = serve(
      [
        {
          status: "complete",
          result: { signed_url: "https://signed.example/dump.sql" },
        },
      ],
      "expired",
      403,
    );
    try {
      await expect(api.d1Export("db-uuid-1")).rejects.toThrow(/HTTP 403/);
    } finally {
      restore();
    }
  });

  it("gives up after 300 polls that never complete", async ({ expect }) => {
    const { api, calls, restore } = serve([
      { status: "active", at_bookmark: "b" },
    ]);
    try {
      await expect(api.d1Export("db-uuid-1")).rejects.toThrow(/300 polls/);
    } finally {
      restore();
    }
    expect(calls).toHaveLength(300);
  });
});
