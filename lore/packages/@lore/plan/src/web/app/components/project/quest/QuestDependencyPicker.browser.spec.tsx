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
  /**
   * The quest's status, as `QuestController.getQuests` filters on it. Absent
   * reads as `todo`.
   */
  status?: string;
}

/**
 * Stands in for the real HTTP-backed `useClient<QuestController>()`. Same
 * substitution seam as `useWikiLinkRewrite.browser.spec.tsx` /
 * `useFolioActions.browser.spec.tsx` (`AGENTS.md`: never
 * `vi.mock`/`vi.spyOn`).
 *
 * Records the exact query the component sends, and mirrors the real list's
 * scope (`QuestController.getQuests`, #E178): with no `status` a draft and a
 * shelved quest are dropped, and a `status` list returns the statuses it
 * names. `QuestDependencyPicker` is the only surface that sets `dependsOn`
 * from the UI, and it must keep offering a draft as a predecessor.
 */
class FakeLinkProvider extends LinkProvider {
  quests: FakeQuest[] = [];
  calls: Array<{ query?: { status?: string } }> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      getQuests: async (config: { query?: { status?: string } }) => {
        this.calls.push({ query: config.query });
        const named = config?.query?.status?.split(",");
        const visible = this.quests.filter((q) => {
          const status = q.status ?? "todo";
          return named
            ? named.includes(status)
            : status !== "draft" && status !== "shelved";
        });
        return { content: visible };
      },
    };
  }
}

describe("QuestDependencyPicker — offers a draft as a predecessor", () => {
  it("names draft among the statuses it fetches, so a draft is in the candidate list", async ({
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
      { id: 5, shortId: 5, title: "Setup pipeline", status: "draft" },
    ];

    render(
      <AlephaContext.Provider value={alepha}>
        <QuestDependencyPicker projectId={1} value={null} onChange={() => {}} />
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(fakeLinks.calls.length).toBe(1));
    // With no status the list leaves drafts out, and the dependency flow
    // would be unusable inside a draft epic. Shelved quests stay out.
    const named = fakeLinks.calls[0]?.query?.status?.split(",") ?? [];
    expect(named).toContain("draft");
    expect(named).toContain("todo");
    expect(named).not.toContain("shelved");
  });
});
