import { Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { LinkProvider } from "alepha/server/links";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import type { ColumnDescriptor } from "./KanbanColumn.tsx";
import { useKanbanMove } from "./useKanbanMove.ts";

/**
 * Refuses the two writes a drop can start with.
 */
class FakeLinkProvider extends LinkProvider {
  calls: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      moveQuestOnBoard: async () => {
        this.calls.push("moveQuestOnBoard");
        throw new Error("The rank could not be minted (spec)");
      },
      acceptQuest: async () => {
        this.calls.push("acceptQuest");
        throw new Error("This quest is on hold (spec)");
      },
    });
  }
}

const quest = (
  id: number,
  status: "todo" | "in_progress",
  kanbanColumn?: string,
): QuestResource =>
  ({
    id,
    shortId: id,
    title: `Quest ${id}`,
    kanbanColumn,
    metadata: { status },
  }) as unknown as QuestResource;

const COLUMNS: ColumnDescriptor[] = [
  { key: "column:To do", kind: "todo", label: "To do" },
  {
    key: "column:In Progress",
    kind: "in_progress",
    subColumn: "In Progress",
    label: "In Progress",
  },
  {
    key: "column:Review",
    kind: "in_progress",
    subColumn: "Review",
    label: "Review",
  },
] as unknown as ColumnDescriptor[];

/**
 * A drop on the board is one `useAction` whose handler paints the move, and on
 * a refusal restores exactly the order it painted over and rethrows, so the
 * root listener toasts it once (#E59, #Q2330).
 *
 * Driven through the hook rather than a pointer: dnd-kit resolves a drop from
 * layout rects, and jsdom lays nothing out.
 */
describe("useKanbanMove", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (initial: QuestResource[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture() as never);
    const app = alepha;
    const wrapper = (props: { children: ReactNode }) => (
      <AlephaContext.Provider value={app}>
        <Toaster visibleToasts={20} />
        <ActionErrorToaster />
        {props.children}
      </AlephaContext.Provider>
    );
    let reloads = 0;
    const view = renderHook(
      () => {
        const [quests, setQuests] = useState(initial);
        const grouped: Record<string, QuestResource[]> = {
          "column:To do": quests.filter((q) => q.metadata.status === "todo"),
          "column:In Progress": quests.filter(
            (q) => q.kanbanColumn === "In Progress",
          ),
          "column:Review": quests.filter((q) => q.kanbanColumn === "Review"),
        };
        const move = useKanbanMove({
          quests,
          setQuests,
          grouped,
          columns: COLUMNS,
          acceptLandsIn: "In Progress",
          reload: async () => {
            reloads++;
          },
        });
        return { quests, move };
      },
      { wrapper },
    );
    return { view, fake: app.inject(FakeLinkProvider), reloads: () => reloads };
  };

  const drop = (dragged: QuestResource, over: Record<string, unknown>) =>
    ({
      active: { data: { current: { type: "quest", quest: dragged } } },
      over: { data: { current: over } },
    }) as never;

  const expectOneToast = async (message: string) => {
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(message)).toHaveLength(1);
  };

  it("puts a card dropped onto another card back in its exact place when the move is refused", async () => {
    const a = quest(1, "in_progress", "In Progress");
    const b = quest(2, "in_progress", "In Progress");
    const c = quest(3, "in_progress", "In Progress");
    const { view, fake, reloads } = await mount([a, b, c]);

    await act(async () => {
      await view.result.current.move.run(drop(c, { type: "card", quest: a }));
    });

    await expectOneToast("The rank could not be minted (spec)");
    expect(fake.calls).toEqual(["moveQuestOnBoard"]);
    expect(view.result.current.quests.map((q) => q.id)).toEqual([1, 2, 3]);
    expect(reloads()).toBe(0);
  });

  it("puts a card dropped onto another column back when the accept is refused, and moves nothing after it", async () => {
    const d = quest(4, "todo");
    const a = quest(1, "in_progress", "In Progress");
    const { view, fake } = await mount([d, a]);

    await act(async () => {
      await view.result.current.move.run(
        drop(d, { type: "column", kind: "in_progress", subColumn: "Review" }),
      );
    });

    await expectOneToast("This quest is on hold (spec)");
    // The sub-column move that would follow an accept never went out.
    expect(fake.calls).toEqual(["acceptQuest"]);
    expect(view.result.current.quests).toEqual([d, a]);
  });
});
