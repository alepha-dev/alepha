import { useElementLinks } from "@lore/core/web";
import { WorkShell } from "@lore/plan/web";
import { KnowledgeShell } from "@lore/remember/web";
import { renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import type React from "react";
import { describe, it } from "vitest";

interface FakeQuest {
  id: number;
  shortId: number;
  title: string;
  /**
   * The quest's status, as `QuestController.getQuests` filters on it. Absent
   * reads as `todo`.
   */
  status?: string;
}

/**
 * Stands in for the real HTTP-backed clients the hook builds. Overriding
 * `LinkProvider.client()` is the documented Alepha service-substitution seam
 * (`AGENTS.md`: never `vi.mock` / `vi.spyOn`).
 *
 * `getQuests` mirrors the real list's scope (`QuestController.getQuests`,
 * #E178): with no `status` a draft and a shelved quest are dropped, and a
 * `status` list returns the statuses it names. A link to a draft must still
 * be offered — this fake is what proves the hook actually names `draft`
 * rather than merely compiling.
 */
class FakeLinkProvider extends LinkProvider {
  quests: FakeQuest[] = [];
  epics: Array<{ id: number; number: number; title: string }> = [];
  /**
   * How many quests `getQuests` answers, like the page size the hook asks
   * for. Only the first `page` of `quests` come back, so a quest past it is
   * one the picker's list does not hold.
   */
  page = Number.POSITIVE_INFINITY;
  /**
   * What `list` answers outside the folio workspace, and every folio the
   * refs endpoint knows.
   */
  pagedFolios: Array<{ id: string; shortId: number; title: string }> = [];
  allFolios: Array<{ shortId: number; title: string }> = [];
  /**
   * The `shortIds` each refs call carried, so a case can assert the request
   * names the body's references and nothing more.
   */
  questRefCalls: string[] = [];
  folioRefCalls: string[] = [];

  /**
   * The refs endpoints answer by number over everything, as the real ones
   * do: `QuestController.listQuestRefs` and `FolioController.listFolioRefs`.
   */
  protected byShortIds<T extends { shortId: number }>(
    rows: T[],
    shortIds: string,
  ): Array<{ shortId: number; title: string }> {
    const wanted = new Set(shortIds.split(",").map(Number));
    return rows
      .filter((row) => wanted.has(row.shortId))
      .map((row) => ({ shortId: row.shortId, title: (row as any).title }));
  }

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      list: async () => this.pagedFolios,
      listQuestRefs: async (config: { query: { shortIds: string } }) => {
        this.questRefCalls.push(config.query.shortIds);
        return this.byShortIds(this.quests, config.query.shortIds);
      },
      listFolioRefs: async (config: { query: { shortIds: string } }) => {
        this.folioRefCalls.push(config.query.shortIds);
        return this.byShortIds(this.allFolios, config.query.shortIds);
      },
      listAttachments: async () => [],
      getEpicRefs: async () => this.epics,
      getQuests: async (config: { query?: { status?: string } }) => {
        const named = config?.query?.status?.split(",");
        const visible = this.quests.filter((q) => {
          const status = q.status ?? "todo";
          return named
            ? named.includes(status)
            : status !== "draft" && status !== "shelved";
        });
        return { content: visible.slice(0, this.page) };
      },
    };
  }
}

const setup = () => {
  const alepha = Alepha.create()
    .with(AlephaLogger)
    .with({ provide: LinkProvider, use: FakeLinkProvider });
  // The kinds the app registers (#E75, #Q2624).
  alepha.inject(KnowledgeShell);
  alepha.inject(WorkShell);
  const fake = alepha.inject(FakeLinkProvider);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
  );
  return { fake, wrapper };
};

/**
 * Merged from the two hooks this one replaced — `useWikiLinkRewrite` covered
 * the rendered half, `useFolioWikiLinks` the suggestions half, and each
 * pinned the same invariant from its own side. One hook now serves both, so
 * one spec asserts both.
 */
describe("useElementLinks — a draft is direct addressing", () => {
  it("resolves [[#Q<n>]] into a real link even when the quest is a draft", async ({
    expect,
  }) => {
    const { fake, wrapper } = setup();
    fake.quests = [
      { id: 1, shortId: 7, title: "Deploy pipeline", status: "draft" },
    ];

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "quest", projectId: 1, projectSlug: "acme" },
          "See [[#Q7]] for details.",
        ),
      { wrapper },
    );

    // A draft must resolve, not be rewritten into a broken-link marker
    // instead of an href.
    await waitFor(() => {
      expect(result.current.rendered).toContain("(/acme/quests/7)");
    });
    expect(result.current.rendered).not.toContain(
      "#lore-broken:quest-not-found",
    );
  });

  it("resolves the typed [[#Q<n>]] form the same way", async ({ expect }) => {
    const { fake, wrapper } = setup();
    fake.quests = [
      { id: 1, shortId: 7, title: "Deploy pipeline", status: "draft" },
    ];

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "quest", projectId: 1, projectSlug: "acme" },
          "See [[#Q7]] for details.",
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.rendered).toContain("(/acme/quests/7)");
    });
  });

  it("offers that same quest in the [[ picker", async ({ expect }) => {
    const { fake, wrapper } = setup();
    fake.quests = [
      { id: 1, shortId: 7, title: "Deploy pipeline", status: "draft" },
    ];

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "quest", projectId: 1, projectSlug: "acme" },
          "",
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions.some((s) => s.token === "#Q7")).toBe(
        true,
      );
    });
  });

  it("the token the picker inserts resolves once it is in the body", async ({
    expect,
  }) => {
    // The picker used to insert `quest#7`, which neither parser read as a
    // quest, and the only spec on it asserted the string. This one takes
    // the token the hook offers and puts it back through the same hook.
    const { fake, wrapper } = setup();
    fake.quests = [{ id: 1, shortId: 7, title: "Deploy pipeline" }];

    const { result, rerender } = renderHook(
      (content: string) =>
        useElementLinks(
          { kind: "quest", projectId: 1, projectSlug: "acme" },
          content,
        ),
      { wrapper, initialProps: "" },
    );

    let token = "";
    await waitFor(() => {
      const quest = result.current.suggestions.find((s) => s.kind === "quest");
      expect(quest).toBeDefined();
      token = quest?.token ?? "";
    });

    rerender(`See [[${token}]] for details.`);

    await waitFor(() => {
      expect(result.current.rendered).toContain("(/acme/quests/7)");
    });
    expect(result.current.rendered).not.toContain("#lore-broken:");
  });

  it("offers epics, which only this hook ever did", async ({ expect }) => {
    const { fake, wrapper } = setup();
    fake.epics = [{ id: 5, number: 3, title: "Lore Deploy" }];

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "epic", projectId: 1, projectSlug: "acme" },
          "See [[#E3]].",
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.rendered).toContain("(/acme/epics/3)");
    });
    expect(result.current.suggestions.some((s) => s.token === "#E3")).toBe(
      true,
    );
  });
});

/**
 * #Q2355: `[[#Q2165]]` rendered as a broken link on a folio because the quest
 * was not among the 100 most recently updated, the page the hook resolved
 * against. A reference now resolves by the numbers the body names.
 */
describe("useElementLinks — a reference resolves outside the picker's page", () => {
  it("renders a link to a quest the recent page does not hold", async ({
    expect,
  }) => {
    const { fake, wrapper } = setup();
    fake.quests = [
      { id: 2, shortId: 2300, title: "Recently updated" },
      { id: 1, shortId: 2165, title: "Bay redirects plain HTTP" },
    ];
    fake.page = 1;

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "folio", projectId: 1, projectSlug: "acme" },
          "See [[#Q2165]] and [[#Q2300]], then [[#Q2165]] again.",
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.rendered).toContain(
        "[Bay redirects plain HTTP](/acme/quests/2165)",
      );
    });
    expect(result.current.rendered).not.toContain("#lore-broken:");
    // Only the numbers the body names, once each, and never a page.
    expect(fake.questRefCalls).toEqual(["2165,2300"]);
    // The picker keeps offering the recent page, not every quest named.
    expect(
      result.current.suggestions.filter((s) => s.kind === "quest"),
    ).toHaveLength(1);
  });

  it("renders a link to a folio outside the folio workspace's list", async ({
    expect,
  }) => {
    const { fake, wrapper } = setup();
    fake.pagedFolios = [];
    fake.allFolios = [{ shortId: 1280, title: "Static files carry headers" }];

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "epic", projectId: 1, projectSlug: "acme" },
          "Design: [[#F1280]].",
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.rendered).toContain(
        "[Static files carry headers](/acme/folios/1280)",
      );
    });
    expect(fake.folioRefCalls).toEqual(["1280"]);
  });

  it("asks for no refs when the body names none", async ({ expect }) => {
    const { fake, wrapper } = setup();
    fake.quests = [{ id: 1, shortId: 7, title: "Deploy pipeline" }];

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "quest", projectId: 1, projectSlug: "acme" },
          "Plain prose, with a [[#E3]] that is not a quest.",
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.suggestions.length).toBeGreaterThan(0);
    });
    expect(fake.questRefCalls).toEqual([]);
    expect(fake.folioRefCalls).toEqual([]);
  });
});
