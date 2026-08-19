import { renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import type React from "react";
import { describe, it } from "vitest";
import { useFolioWikiLinks } from "./useFolioWikiLinks.ts";

interface FakeQuest {
  id: number;
  shortId: number;
  title: string;
  epicId?: number;
}

/**
 * Stands in for the real HTTP-backed `useClient<QuestController>()` this
 * hook builds. Same substitution seam as
 * `useWikiLinkRewrite.browser.spec.tsx` and `useFolioActions.browser.spec.tsx`
 * (`CLAUDE.md`: never `vi.mock`/`vi.spyOn`).
 *
 * `getQuests` mirrors the real backlog gate
 * (`EpicVisibilityService.applyBacklogGate`): a quest filed under a
 * `planned` epic is dropped UNLESS the caller passes `includePlanned: true`
 * — the flag the `[[quest:` autocomplete must set, or an author cannot
 * even create the link while the epic stays planned (design §5.3).
 */
class FakeLinkProvider extends LinkProvider {
  quests: FakeQuest[] = [];
  plannedEpicIds = new Set<number>();

  // biome-ignore lint/suspicious/noExplicitAny: matches the real client's own loose virtual-action shape
  override client<T extends object>(): any {
    return {
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

describe("useFolioWikiLinks — the [[quest: picker offers a planned epic's quest", () => {
  it("includes a quest filed under a planned epic among its suggestions", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    await alepha.start();

    const fakeLinks = alepha.inject(FakeLinkProvider);
    fakeLinks.quests = [
      { id: 1, shortId: 12, title: "Deploy pipeline", epicId: 42 },
    ];
    fakeLinks.plannedEpicIds = new Set([42]);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    const { result } = renderHook(
      () => useFolioWikiLinks(1, "acme", "some draft [[quest:"),
      { wrapper },
    );

    // Before the fix, the missing `includePlanned: true` made the gate
    // hide the quest, so the picker could never offer it as a candidate.
    await waitFor(() => {
      expect(result.current.suggestions.some((s) => s.key === "quest:12")).toBe(
        true,
      );
    });
  });
});
