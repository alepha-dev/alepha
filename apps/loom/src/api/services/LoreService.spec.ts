import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LoreService } from "./LoreService.ts";

/**
 * Answers Lore's two endpoints from memory, and records what was asked.
 */
class TestLoreService extends LoreService {
  public requests: string[] = [];

  protected override async request<T>(path: string): Promise<T | undefined> {
    this.requests.push(path);
    if (path === "/api/getEpicRefs/1") {
      return [{ id: 103, number: 53, title: "Loom", status: "active" }] as T;
    }
    const shortId = Number(/quests\/(\d+)$/.exec(path)?.[1]);
    if (shortId === 2224) {
      return {
        shortId,
        title: "Loom v1",
        status: "accepted",
        epicId: 103,
      } as T;
    }
    return undefined;
  }
}

const project = {
  id: "alepha",
  name: "alepha",
  path: "/repo",
  loreProjectId: 1,
  loreProjectSlug: "alepha",
};

describe("LoreService", () => {
  it("finds every #Q number once, newest first", ({ expect }) => {
    const alepha = Alepha.create();
    const lore = alepha.inject(LoreService);

    expect(
      lore.questIds(
        [
          "Merge remote-tracking branch 'origin/main' (#Q2220)",
          "fix(loom): the path (#Q2220)",
          "feat(loom): deploy (#Q2218)",
          "not a quest: #Q, Q12, #12",
        ].join("\n"),
      ),
    ).toEqual([2220, 2218]);
  });

  it("links quests without asking Lore when there is no key", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: LoreService,
      use: TestLoreService,
    });
    const lore = alepha.inject(TestLoreService);

    const refs = await lore.resolve(project, [2224]);

    expect(refs.get(2224)).toEqual({
      shortId: 2224,
      url: "https://lore.alepha.dev/alepha/quests/2224",
    });
    expect(lore.requests).toEqual([]);
  });

  it("adds title, status and epic with a key", async ({ expect }) => {
    const alepha = Alepha.create({ env: { LORE_API_KEY: "key" } }).with({
      provide: LoreService,
      use: TestLoreService,
    });
    const lore = alepha.inject(TestLoreService);

    const refs = await lore.resolve(project, [2224, 9999]);

    expect(refs.get(2224)).toEqual({
      shortId: 2224,
      title: "Loom v1",
      status: "accepted",
      url: "https://lore.alepha.dev/alepha/quests/2224",
      epic: { number: 53, title: "Loom", status: "active" },
    });
    // A quest Lore does not know stays a bare number and link.
    expect(refs.get(9999)).toEqual({
      shortId: 9999,
      url: "https://lore.alepha.dev/alepha/quests/9999",
    });
  });
});
