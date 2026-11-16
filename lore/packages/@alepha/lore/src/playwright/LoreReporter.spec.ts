import { afterEach, describe, it } from "vitest";

import { LoreReporter } from "./LoreReporter.ts";

/**
 * The reporter (#E153, #Q3770): `@U7` tests become one run of #U7, their
 * `C2` keys its results, a failure wins over a pass for one criterion.
 */
describe("LoreReporter", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const test = (
    title: string,
    tags: string[],
    annotations: Array<{ type: string; description?: string }> = [],
  ) => ({ title, tags, annotations }) as never;
  const result = (status: string, message?: string) =>
    ({ status, error: message ? { message } : undefined }) as never;

  it("records one run per use case with each criterion's outcome", async ({
    expect,
  }) => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return new Response("{}", { status: 200 });
    }) as never;

    const reporter = new LoreReporter({
      project: 7,
      apiKey: "key",
      url: "https://lore.test",
      app: "shop",
      env: "staging",
    });
    reporter.onTestEnd(test("C1 creates a code", ["@U7"]), result("passed"));
    reporter.onTestEnd(
      test("C2 shows the discount", ["@U7"]),
      result("failed", "Expected 7.35\nat x"),
    );
    reporter.onTestEnd(
      test(
        "shows it again",
        ["@U7"],
        [{ type: "criterion", description: "c2" }],
      ),
      result("passed"),
    );
    reporter.onTestEnd(test("C1 untagged", []), result("passed"));
    reporter.onTestEnd(test("@U8 C3 skipped", []), result("skipped"));
    await reporter.onEnd({} as never);

    expect(calls.map((it) => it.url)).toEqual([
      "https://lore.test/api/recordUseCaseRun/7",
      "https://lore.test/api/recordUseCaseRun/7",
    ]);
    expect(calls[0].body).toEqual({
      useCaseNumber: 7,
      by: "ci",
      client: "playwright",
      app: "shop",
      env: "staging",
      results: [
        { key: "C1", result: "passed" },
        { key: "C2", result: "failed", note: "Expected 7.35" },
      ],
    });
    expect(calls[1].body.results).toEqual([{ key: "C3", result: "not_run" }]);
  });

  it("records nothing without a key", async ({ expect }) => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as never;
    const reporter = new LoreReporter({ project: 7, apiKey: "" });
    const previous = process.env.LORE_API_KEY;
    delete process.env.LORE_API_KEY;
    reporter.onTestEnd(test("C1", ["@U7"]), result("passed"));
    await reporter.onEnd({} as never);
    if (previous !== undefined) process.env.LORE_API_KEY = previous;
    expect(called).toBe(false);
  });
});
