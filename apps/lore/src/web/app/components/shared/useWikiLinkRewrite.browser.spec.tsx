import { renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import type React from "react";
import { describe, it } from "vitest";
import { useWikiLinkRewrite } from "./useWikiLinkRewrite.ts";

interface FakeQuest {
  id: number;
  shortId: number;
  title: string;
  epicId?: number;
}

/**
 * Stands in for the real HTTP-backed `useClient<FolioController>()` /
 * `useClient<QuestController>()` `useWikiLinkRewrite` builds. Overriding
 * `LinkProvider.client()` is the documented Alepha service-substitution
 * seam (`CLAUDE.md`: never `vi.mock`/`vi.spyOn`) — see
 * `useFolioActions.browser.spec.tsx` for the same pattern.
 *
 * `getQuests` mirrors the real backlog gate
 * (`EpicVisibilityService.applyBacklogGate`, applied by
 * `QuestController.getQuests`): a quest filed under a `planned` epic is
 * dropped from the result UNLESS the caller passes `includePlanned: true`.
 * Wiki-links are direct addressing and must stay "never gated" (design
 * §5.3) — this is what proves the hook actually sets the flag rather than
 * merely compiling.
 */
class FakeLinkProvider extends LinkProvider {
  quests: FakeQuest[] = [];
  plannedEpicIds = new Set<number>();

  // biome-ignore lint/suspicious/noExplicitAny: matches the real client's own loose virtual-action shape
  override client<T extends object>(): any {
    return {
      list: async () => [],
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

describe("useWikiLinkRewrite — a planned epic's quest is direct addressing (never gated)", () => {
  it("resolves [[quest:#N]] into a real link for a quest filed under a planned epic", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    const fakeLinks = alepha.inject(FakeLinkProvider);
    fakeLinks.quests = [
      { id: 1, shortId: 7, title: "Deploy pipeline", epicId: 99 },
    ];
    fakeLinks.plannedEpicIds = new Set([99]);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useWikiLinkRewrite("See [[quest:#7]] for details.", 1, "acme"),
      { wrapper },
    );

    // Before the fix, the missing `includePlanned: true` made the gate hide
    // the quest, so the resolver could not find it and rewrote the token
    // into a broken-link marker instead of a real href.
    await waitFor(() => {
      expect(result.current.content).toContain("(/acme/quests/7)");
    });
    expect(result.current.content).not.toContain("lore-broken:quest-not-found");
    expect(result.current.questRefs).toEqual([
      { shortId: 7, title: "Deploy pipeline" },
    ]);
  });
});
