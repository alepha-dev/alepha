import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { LoreChangelog, type LoreFetch } from "../scripts/LoreChangelog.ts";

describe("LoreChangelog", () => {
  const boot = () => Alepha.create().inject(LoreChangelog);

  /**
   * A fake Lore answering the three endpoints the reader calls, and recording
   * what it was asked.
   */
  const lore = () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const routes: Record<string, unknown> = {
      "/api/getReleases/1": [
        { id: 7, tag: "0.36.0", releasedAt: "2026-11-06T23:20:56.403Z" },
        { id: 9, tag: "1.0.0" },
        { id: 8, tag: "0.37.0", releasedAt: "2026-11-10T17:24:54.657Z" },
      ],
      "/api/getReleaseChangelog/8": {
        groups: [
          {
            kind: "epic",
            name: "Forms validate on the server too",
            quests: [{ shortId: 11, title: "A form validates its schema" }],
          },
          {
            kind: "area",
            name: "alepha/orm",
            quests: [
              { shortId: 12, title: "A partial index names its columns" },
            ],
          },
        ],
      },
      "/api/getReleaseContents/8": {
        epics: [{ quests: [{ shortId: 11, area: "alepha/react/form" }] }],
        looseQuests: [{ shortId: 12, area: "alepha/orm" }],
      },
      "/api/getReleaseChangelog/7": {
        groups: [
          {
            kind: "area",
            name: "bay",
            quests: [{ shortId: 5, title: "A stack restarts after a crash" }],
          },
        ],
      },
      "/api/getReleaseContents/7": {
        epics: [],
        looseQuests: [{ shortId: 5, area: "bay" }],
      },
    };
    const fetcher = (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({
        url: url.pathname,
        authorization: (init?.headers as Record<string, string>)?.authorization,
      });
      const body = routes[url.pathname];
      return body === undefined
        ? new Response("not found", { status: 404 })
        : Response.json(body);
    }) satisfies LoreFetch;
    return { calls, fetcher };
  };

  it("reads the published releases, newest first, and skips the open ones", async () => {
    const { calls, fetcher } = lore();
    const entries = await boot().read({ LORE_API_KEY: "k" }, fetcher);

    expect(entries.map((entry) => entry.version)).toEqual(["0.37.0", "0.36.0"]);
    expect(entries[0].date).toBe("2026-11-10");
    // The open release 1.0.0 (id 9) is never read.
    expect(calls.some((call) => call.url.endsWith("/9"))).toBe(false);
    expect(calls.every((call) => call.authorization === "Bearer k")).toBe(true);
  });

  it("keeps Lore's grouping and gives every quest its area as a module path", async () => {
    const { fetcher } = lore();
    const [latest] = await boot().read({ LORE_API_KEY: "k" }, fetcher);

    expect(latest.groups).toEqual([
      {
        kind: "epic",
        name: "Forms validate on the server too",
        changes: [
          { scope: "react/form", message: "A form validates its schema" },
        ],
      },
      {
        kind: "area",
        name: "orm",
        changes: [
          { scope: "orm", message: "A partial index names its columns" },
        ],
      },
    ]);
  });

  /**
   * Lore has both a `cli` and an `alepha/cli` area, and both read `cli`. Two
   * sections of one name gave the page a duplicate React key, which left a
   * stale row on screen once the scope filter removed one of them.
   */
  it("merges two areas that read the same into one group", () => {
    const entry = boot().toEntry(
      { id: 1, tag: "0.37.0", releasedAt: "2026-11-10T17:24:54.657Z" },
      {
        groups: [
          { kind: "area", name: "cli", quests: [{ shortId: 1, title: "One" }] },
          {
            kind: "area",
            name: "alepha/cli",
            quests: [{ shortId: 2, title: "Two" }],
          },
        ],
      },
      {
        epics: [],
        looseQuests: [
          { shortId: 1, area: "cli" },
          { shortId: 2, area: "alepha/cli" },
        ],
      },
    );

    expect(entry.groups).toEqual([
      {
        kind: "area",
        name: "cli",
        changes: [
          { scope: "cli", message: "One" },
          { scope: "cli", message: "Two" },
        ],
      },
    ]);
  });

  /**
   * The page is user documentation: no quest number reaches it.
   */
  it("carries no Lore reference", async () => {
    const { fetcher } = lore();
    const entries = await boot().read({ LORE_API_KEY: "k" }, fetcher);

    expect(JSON.stringify(entries)).not.toMatch(/shortId|#Q|lore\.alepha\.dev/);
  });

  it("reads LORE_URL when it is set", async () => {
    const { fetcher } = lore();
    const seen: string[] = [];
    await boot().read(
      { LORE_API_KEY: "k", LORE_URL: "https://lore.example.app/" },
      (async (input: string, init?: RequestInit) => {
        seen.push(new URL(input).origin);
        return fetcher(input, init);
      }) satisfies LoreFetch,
    );

    expect(new Set(seen)).toEqual(new Set(["https://lore.example.app"]));
  });

  it("fails the build when Lore refuses, rather than publishing an empty page", async () => {
    await expect(
      boot().read(
        { LORE_API_KEY: "k" },
        (async () => new Response("no", { status: 401 })) satisfies LoreFetch,
      ),
    ).rejects.toThrow(/401/);
  });

  it("falls back to the sample without a key", async () => {
    const entries = await boot().read({}, (async () => {
      throw new Error("no request without a key");
    }) satisfies LoreFetch);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].groups.length).toBeGreaterThan(0);
  });

  describe("scopeOf", () => {
    const scopeOf = (area: string | undefined) => boot().scopeOf(area);

    it("strips the package prefix of a framework area", () => {
      expect(scopeOf("alepha/api/users")).toBe("api/users");
      expect(scopeOf("@alepha/ui")).toBe("ui");
      expect(scopeOf("alepha/cli")).toBe("cli");
    });

    it("leaves Lore's and Bay's areas as they are", () => {
      expect(scopeOf("lore/quests")).toBe("lore/quests");
      expect(scopeOf("bay")).toBe("bay");
    });

    it("names the bare framework area and a missing one", () => {
      expect(scopeOf("alepha")).toBe("core");
      expect(scopeOf(undefined)).toBe("misc");
      expect(scopeOf("Uncategorized")).toBe("misc");
    });
  });
});
