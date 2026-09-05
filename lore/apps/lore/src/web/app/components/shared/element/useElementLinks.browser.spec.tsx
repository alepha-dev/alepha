import { renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import type React from "react";
import { describe, it } from "vitest";

import { useElementLinks } from "./useElementLinks.ts";

interface FakeQuest {
  id: number;
  shortId: number;
  title: string;
  epicId?: number;
}

/**
 * Stands in for the real HTTP-backed clients the hook builds. Overriding
 * `LinkProvider.client()` is the documented Alepha service-substitution seam
 * (`CLAUDE.md`: never `vi.mock` / `vi.spyOn`).
 *
 * `getQuests` mirrors the real backlog gate
 * (`EpicVisibilityService.applyBacklogGate`, applied by
 * `QuestController.getQuests`): a quest filed under a `planned` epic is
 * dropped UNLESS the caller passes `includePlanned: true`. Wiki-links are
 * direct addressing and must stay "never gated" (design §5.3) — this fake is
 * what proves the hook actually sets the flag rather than merely compiling.
 */
class FakeLinkProvider extends LinkProvider {
  quests: FakeQuest[] = [];
  epics: Array<{ id: number; number: number; title: string }> = [];
  plannedEpicIds = new Set<number>();

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      list: async () => [],
      listAttachments: async () => [],
      getEpics: async () => this.epics,
      getQuests: async (config: { query?: { includePlanned?: boolean } }) => {
        const includePlanned = config?.query?.includePlanned === true;
        const visible = includePlanned
          ? this.quests
          : this.quests.filter(
              (q) => q.epicId == null || !this.plannedEpicIds.has(q.epicId),
            );
        return { content: visible };
      },
    };
  }
}

const setup = () => {
  const alepha = Alepha.create()
    .with(AlephaLogger)
    .with({ provide: LinkProvider, use: FakeLinkProvider });
  const fake = alepha.inject(FakeLinkProvider);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
  );
  return { fake, wrapper };
};

/**
 * Merged from the two hooks this one replaced — `useWikiLinkRewrite` covered
 * the rendered half, `useFolioWikiLinks` the suggestions half, and each
 * pinned the same gate invariant from its own side. One hook now serves
 * both, so one spec asserts both.
 */
describe("useElementLinks — a planned epic's quest is direct addressing", () => {
  it("resolves [[#Q<n>]] into a real link even when the epic is planned", async ({
    expect,
  }) => {
    const { fake, wrapper } = setup();
    fake.quests = [{ id: 1, shortId: 7, title: "Deploy pipeline", epicId: 99 }];
    fake.plannedEpicIds = new Set([99]);

    const { result } = renderHook(
      () =>
        useElementLinks(
          { kind: "quest", projectId: 1, projectSlug: "acme" },
          "See [[#Q7]] for details.",
        ),
      { wrapper },
    );

    // Without `includePlanned: true` the gate hides the quest, the resolver
    // cannot find it, and the token is rewritten into a broken-link marker
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
    fake.quests = [{ id: 1, shortId: 7, title: "Deploy pipeline", epicId: 99 }];
    fake.plannedEpicIds = new Set([99]);

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
    fake.quests = [{ id: 1, shortId: 7, title: "Deploy pipeline", epicId: 99 }];
    fake.plannedEpicIds = new Set([99]);

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
