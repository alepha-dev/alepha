import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";
import { currentEpicsAtom } from "../../atoms/currentEpicsAtom.ts";
import type { ColumnDescriptor } from "./KanbanColumn.tsx";
import { KanbanGrouping } from "./kanbanGrouping.ts";
import { useKanbanMove } from "./useKanbanMove.ts";

/**
 * Refuses the two writes a drop can start with, and accepts the draft
 * verbs, recording each call with what it was given.
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
      readyQuest: async (req: { params: { id: number } }) => {
        this.calls.push(`readyQuest:${req.params.id}`);
        return { id: req.params.id, metadata: { status: "todo" } };
      },
      draftQuest: async (req: { params: { id: number } }) => {
        this.calls.push(`draftQuest:${req.params.id}`);
        return { id: req.params.id, metadata: { status: "draft" } };
      },
      setEpicStatus: async (req: {
        params: { id: number };
        body: { status: string };
      }) => {
        this.calls.push(`setEpicStatus:${req.params.id}:${req.body.status}`);
        return { id: req.params.id, status: req.body.status };
      },
      countOpenQuests: async () => ({ count: 0 }),
    });
  }
}

const quest = (
  id: number,
  status: "draft" | "todo" | "in_progress" | "on_hold" | "completed",
  kanbanColumn?: string,
  epicId?: number,
): QuestResource =>
  ({
    id,
    shortId: id,
    projectId: 1,
    title: `Quest ${id}`,
    kanbanColumn,
    epicId,
    draftAt: status === "draft" ? "2026-11-20T00:00:00.000Z" : undefined,
    metadata: { status },
  }) as unknown as QuestResource;

const COLUMNS: ColumnDescriptor[] = [
  { key: "column:Draft", kind: "draft", label: "Draft" },
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

  const grouping = new KanbanGrouping();

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
    alepha.store.set(currentProjectAtom, projectFixture());
    alepha.store.set(currentEpicsAtom, [
      { id: 7, number: 12, title: "Checkout", status: "draft" },
    ] as never);
    const app = alepha;
    const wrapper = (props: { children: ReactNode }) => (
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          {props.children}
        </DialogProvider>
      </AlephaContext.Provider>
    );
    let reloads = 0;
    const view = renderHook(
      () => {
        const [quests, setQuests] = useState(initial);
        const grouped = grouping.group(quests, COLUMNS);
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
  /**
   * #Q4376: the Draft column's one door is To do.
   */
  describe("the Draft column", () => {
    const statusOf = (quests: QuestResource[], id: number) =>
      quests.find((q) => q.id === id)?.metadata.status;

    it("marks a loose draft ready when it is dropped on To do", async () => {
      const d = quest(1, "draft");
      const { view, fake, reloads } = await mount([d]);

      await act(async () => {
        await view.result.current.move.run(
          drop(d, { type: "column", kind: "todo" }),
        );
      });

      expect(fake.calls).toEqual(["readyQuest:1"]);
      expect(statusOf(view.result.current.quests, 1)).toBe("todo");
      expect(reloads()).toBe(1);
    });

    it("marks a loose to-do quest draft when it is dropped on Draft", async () => {
      const t = quest(2, "todo");
      const { view, fake } = await mount([t]);

      await act(async () => {
        await view.result.current.move.run(
          drop(t, { type: "column", kind: "draft" }),
        );
      });

      expect(fake.calls).toEqual(["draftQuest:2"]);
      expect(statusOf(view.result.current.quests, 2)).toBe("draft");
    });

    it("refuses a draft dropped anywhere but To do, with the reason", async () => {
      const d = quest(1, "draft");
      const { view, fake } = await mount([d]);

      await act(async () => {
        await view.result.current.move.run(
          drop(d, {
            type: "column",
            kind: "in_progress",
            subColumn: "In Progress",
          }),
        );
      });

      await expectOneToast(
        "A draft cannot be taken yet: drop it on To do to mark it ready first.",
      );
      expect(fake.calls).toEqual([]);
      expect(statusOf(view.result.current.quests, 1)).toBe("draft");
    });

    it("refuses an accepted quest dropped on Draft", async () => {
      const a = quest(3, "in_progress", "In Progress");
      const { view, fake } = await mount([a]);

      await act(async () => {
        await view.result.current.move.run(
          drop(a, { type: "column", kind: "draft" }),
        );
      });

      await expectOneToast(
        "This quest is taken: unassign it first, then drop it on Draft.",
      );
      expect(fake.calls).toEqual([]);
    });

    it("refuses a held quest dropped on Draft, saying to lift the hold rather than unassign", async () => {
      const a = {
        ...quest(4, "on_hold"),
        heldAt: "2026-11-21T00:00:00.000Z",
      } as QuestResource;
      const { view, fake } = await mount([a]);

      await act(async () => {
        await view.result.current.move.run(
          drop(a, { type: "column", kind: "draft" }),
        );
      });

      await expectOneToast(
        "This quest is on hold: lift the hold first. Only a quest still to do, and taken by nobody, can go to Draft.",
      );
      expect(fake.calls).toEqual([]);
    });

    it("refuses a completed quest dropped on Draft", async () => {
      const a = {
        ...quest(5, "completed"),
        completedAt: "2026-11-21T00:00:00.000Z",
      } as QuestResource;
      const { view, fake } = await mount([a]);

      await act(async () => {
        await view.result.current.move.run(
          drop(a, { type: "column", kind: "draft" }),
        );
      });

      await expectOneToast(
        "A completed quest cannot go back to Draft: file the follow-up as a new quest.",
      );
      expect(fake.calls).toEqual([]);
    });

    it("offers to mark the whole epic ready for an epic's draft dropped on To do, and moves every card of it", async () => {
      const a = quest(1, "draft", undefined, 7);
      const b = quest(2, "draft", undefined, 7);
      const loose = quest(3, "draft");
      const { view, fake } = await mount([a, b, loose]);

      let run: Promise<unknown> | undefined;
      act(() => {
        run = view.result.current.move.run(
          drop(a, { type: "column", kind: "todo" }),
        );
      });
      const confirm = await screen.findByRole("button", {
        name: "Mark #E12 ready (2 quests)",
      });
      // Nothing moves before the answer.
      expect(fake.calls).toEqual([]);
      expect(statusOf(view.result.current.quests, 1)).toBe("draft");

      await act(async () => {
        fireEvent.click(confirm);
        await run;
      });

      expect(fake.calls).toEqual(["setEpicStatus:7:ready"]);
      expect(statusOf(view.result.current.quests, 1)).toBe("todo");
      expect(statusOf(view.result.current.quests, 2)).toBe("todo");
      // A loose draft is not the epic's, and stays where it was.
      expect(statusOf(view.result.current.quests, 3)).toBe("draft");
    });

    it("moves nothing when the epic confirm is cancelled", async () => {
      const a = quest(1, "draft", undefined, 7);
      const { view, fake } = await mount([a]);

      let run: Promise<unknown> | undefined;
      act(() => {
        run = view.result.current.move.run(
          drop(a, { type: "column", kind: "todo" }),
        );
      });
      const cancel = await screen.findByRole("button", { name: "Cancel" });
      await act(async () => {
        fireEvent.click(cancel);
        await run;
      });

      expect(fake.calls).toEqual([]);
      expect(statusOf(view.result.current.quests, 1)).toBe("draft");
    });

    it("refuses an epic's to-do quest dropped on Draft, naming the epic", async () => {
      const t = quest(4, "todo", undefined, 7);
      const { view, fake } = await mount([t]);

      await act(async () => {
        await view.result.current.move.run(
          drop(t, { type: "column", kind: "draft" }),
        );
      });

      await expectOneToast(
        "This quest belongs to #E12, whose status decides for all of its quests: send the epic back to draft from its page.",
      );
      expect(fake.calls).toEqual([]);
    });

    it("refuses an epic's draft dropped past To do, naming the epic", async () => {
      const d = quest(5, "draft", undefined, 7);
      const { view, fake } = await mount([d]);

      await act(async () => {
        await view.result.current.move.run(
          drop(d, { type: "column", kind: "completed" }),
        );
      });

      await expectOneToast(
        "This draft belongs to #E12, and its quests become ready together: drop it on To do to mark the whole epic ready.",
      );
      expect(fake.calls).toEqual([]);
    });
  });
});
