import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import QuestDependencyPicker from "./QuestDependencyPicker.tsx";

interface FakeQuest {
  id: number;
  shortId: number;
  title: string;
  epicId?: number;
}

/**
 * Stands in for the real HTTP-backed `useClient<QuestController>()`. Same
 * substitution seam as `useWikiLinkRewrite.browser.spec.tsx` /
 * `useFolioActions.browser.spec.tsx` (`CLAUDE.md`: never
 * `vi.mock`/`vi.spyOn`).
 *
 * Records the exact query the component sends, and mirrors the real
 * backlog gate (`EpicVisibilityService.applyBacklogGate`): a quest filed
 * under a `draft` epic is dropped UNLESS the caller passes
 * `includeDrafts: true`. `QuestDependencyPicker` is the only surface that
 * sets `dependsOn` from the UI, and it must keep offering a draft epic's
 * quest as a predecessor (design §5.3, direct addressing is never gated).
 */
class FakeLinkProvider extends LinkProvider {
  quests: FakeQuest[] = [];
  draftEpicIds = new Set<number>();
  calls: Array<{ query?: { includeDrafts?: boolean } }> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      getQuests: async (config: { query?: { includeDrafts?: boolean } }) => {
        this.calls.push({ query: config.query });
        const includeDrafts = config?.query?.includeDrafts === true;
        const visible = includeDrafts
          ? this.quests
          : this.quests.filter(
              (q) => q.epicId == null || !this.draftEpicIds.has(q.epicId),
            );
        return { content: visible };
      },
    };
  }
}

describe("QuestDependencyPicker — offers a draft epic's quest as a predecessor", () => {
  it("fetches with includeDrafts: true so a draft-epic quest is in the candidate list", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with({ provide: LinkProvider, use: FakeLinkProvider });
    await alepha.start();

    const fakeLinks = alepha.inject(FakeLinkProvider);
    fakeLinks.quests = [
      { id: 5, shortId: 5, title: "Setup pipeline", epicId: 7 },
    ];
    fakeLinks.draftEpicIds = new Set([7]);

    render(
      <AlephaContext.Provider value={alepha}>
        <QuestDependencyPicker projectId={1} value={null} onChange={() => {}} />
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(fakeLinks.calls.length).toBe(1));
    // Before the fix, this query omitted `includeDrafts`, so the gate
    // dropped the draft-epic quest from the candidate list — the
    // dependency flow was unusable inside a draft epic.
    expect(fakeLinks.calls[0]?.query).toMatchObject({
      includeDrafts: true,
    });
  });
});
