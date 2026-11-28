import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import EpicQuestPicker from "./EpicQuestPicker.tsx";

interface FakeQuest {
  id: number;
  shortId: number;
  title: string;
  metadata: { status: string };
}

/**
 * Mirrors the real list's scope (`QuestController.getQuests`, #E178): with no
 * `status` a draft and a shelved quest are dropped, and a `status` list
 * returns the statuses it names. Records every `status` the picker asks for.
 */
class FakeLinkProvider extends LinkProvider {
  public quests: FakeQuest[] = [];
  public asked: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getQuests: async (config: { query?: { status?: string } }) => {
        this.asked.push(config?.query?.status ?? "");
        const named = config?.query?.status?.split(",");
        return {
          content: this.quests.filter((q) =>
            named
              ? named.includes(q.metadata.status)
              : q.metadata.status !== "draft" &&
                q.metadata.status !== "shelved",
          ),
        };
      },
    });
  }
}

/**
 * The picker that files a quest into an epic offers a draft, loose or of
 * another draft epic: the list leaves drafts out unless they are named, so
 * the picker names `draft` beside `todo`.
 */
describe("EpicQuestPicker", () => {
  it("lists a draft beside the open and the closed quests", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const fake = alepha.inject(FakeLinkProvider);
    fake.quests = [
      {
        id: 1,
        shortId: 11,
        title: "Sketch the API",
        metadata: { status: "draft" },
      },
      {
        id: 2,
        shortId: 12,
        title: "Wire the route",
        metadata: { status: "todo" },
      },
      {
        id: 3,
        shortId: 13,
        title: "Ship the page",
        metadata: { status: "completed" },
      },
    ];

    render(
      <AlephaContext.Provider value={alepha}>
        <EpicQuestPicker
          projectId={1}
          attachedIds={new Set()}
          disabled={false}
          onAttach={() => {}}
        />
      </AlephaContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /attach/i }));

    await waitFor(() => {
      expect(screen.getByText("Sketch the API")).toBeTruthy();
    });
    expect(screen.getByText("Wire the route")).toBeTruthy();
    expect(screen.getByText("Ship the page")).toBeTruthy();
    expect(fake.asked.sort()).toEqual([
      "completed,shelved",
      "todo,draft,in_progress,on_hold",
    ]);
    expect(screen.getByTestId("epic-quest-picker-status-11").textContent).toBe(
      "Draft",
    );
  });
});
