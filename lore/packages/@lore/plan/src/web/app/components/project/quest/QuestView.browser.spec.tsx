import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  ResourceRailRegistry,
  PinnedPromptsSlot,
} from "@lore/core/web";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { EpicRefResource } from "../../../../../api/schemas/epicRefResourceSchema.ts";
import {
  type QuestResource,
  questResourceSchema,
} from "../../../../../api/schemas/questResourceSchema.ts";
import { currentEpicsAtom } from "../../../atoms/currentEpicsAtom.ts";
import { WorkShell } from "../../../shell/WorkShell.ts";
import QuestView from "./QuestView.tsx";

/**
 * Refuses the shelve, and answers every read the page makes with nothing.
 */
class FakeLinkProvider extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  shelveCalls = 0;

  /**
   * What the server answers for the project's epics, so a spec can make it
   * disagree with the loader's snapshot in `currentEpicsAtom`.
   */
  epicRefs: EpicRefResource[] = [];

  unassignCalls = 0;

  /**
   * The project's members, for the assignee picker.
   */
  users: Array<{ id: string; username: string }> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      shelveQuest: async () => {
        this.shelveCalls++;
        throw new Error("This quest has an open dependent (spec)");
      },
      getQuestLine: async () => ({ dependents: [] }),
      listQuestComments: async () => [],
      listQuestAttachments: async () => [],
      getProjectUsers: async () => this.users,
      unassignQuest: async () => {
        this.unassignCalls++;
        const quest = this.quest();
        return {
          ...quest,
          acceptedAt: undefined,
          acceptedBy: undefined,
          metadata: { ...quest.metadata, status: "todo" },
        };
      },
      listQuestTags: async () => [],
      getEpicRefs: async () => this.epicRefs,
    });
  }

  public quest(): QuestResource {
    const generated = this.faker.generate(questResourceSchema);
    return {
      ...generated,
      id: 1,
      shortId: 1,
      projectId: 1,
      title: "Ship it",
      acceptedAt: "2026-08-26T10:00:00.000Z",
      completedAt: undefined,
      shelvedAt: undefined,
      heldAt: undefined,
      epicId: undefined,
      feedbackId: undefined,
      dueAt: undefined,
      attachments: [],
      objectives: [],
      timerSessions: [],
      metadata: { ...generated.metadata, status: "in_progress" },
    };
  }
}

/**
 * The routes the page links to, so `Link` and `router.path` resolve.
 */
class Routes {
  quests = $page({
    name: "projectQuests",
    path: "/quests",
    component: () => null,
  });
  quest = $page({
    name: "projectQuest",
    path: "/quests/:shortId",
    component: () => null,
  });
  epic = $page({
    name: "projectEpic",
    path: "/epics/:epicNumber",
    component: () => null,
  });
}

/**
 * `QuestView`'s lifecycle verbs run `useQuestMutations` inside a `useAction`
 * each (#E59, #Q2328). Before, the handlers awaited the mutation with no
 * catch, so a refused shelve was an unhandled rejection and the page said
 * nothing. Now the root listener says why, exactly once, and the quest is
 * not shown as shelved.
 */
describe("QuestView", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("toasts a refused shelve exactly once", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    // Work registers the reference and agent prompt kinds (#E75, #Q2624).
    alepha.inject(WorkShell);
    // Read by the quest rail (#E154), so it must exist before the lock.
    alepha.inject(ResourceRailRegistry);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    const fake = alepha.inject(FakeLinkProvider);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <QuestView quest={fake.quest()} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Shelve" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Shelve quest" }),
    );

    const message = "This quest has an open dependent (spec)";
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(fake.shelveCalls).toBe(1);
    // Refused, so the rail still offers Shelve rather than Unshelve.
    expect(screen.getByRole("button", { name: "Shelve" })).toBeTruthy();
  });
  it("enables Accept on a quest whose epic was readied after the project loaded", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    // Read by the quest rail (#E154), so it must exist before the lock.
    alepha.inject(ResourceRailRegistry);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    // The loader's snapshot, taken while epic 7 was still a draft (#Q3759).
    alepha.store.set(currentEpicsAtom, [
      { id: 7, number: 7, title: "Plan", status: "draft" },
    ]);
    const fake = alepha.inject(FakeLinkProvider);
    // Readied since: the server says so.
    fake.epicRefs = [{ id: 7, number: 7, title: "Plan", status: "ready" }];
    const quest = fake.quest();

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <QuestView
            quest={{
              ...quest,
              epicId: 7,
              acceptedAt: undefined,
              metadata: { ...quest.metadata, status: "todo" },
            }}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const accept = await screen.findByRole("button", {
      name: "Accept the quest",
    });
    await waitFor(() =>
      expect((accept as HTMLButtonElement).disabled).toBe(false),
    );
    expect(accept.getAttribute("title")).toBeNull();
    // The snapshot is refreshed too, so the other readers agree.
    expect(alepha.store.get(currentEpicsAtom)?.[0]?.status).toBe("ready");
  });

  it("still withholds Accept while the server reads the epic as a draft", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    // Read by the quest rail (#E154), so it must exist before the lock.
    alepha.inject(ResourceRailRegistry);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    const fake = alepha.inject(FakeLinkProvider);
    fake.epicRefs = [{ id: 7, number: 7, title: "Plan", status: "draft" }];
    const quest = fake.quest();

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <QuestView
            quest={{
              ...quest,
              epicId: 7,
              acceptedAt: undefined,
              metadata: { ...quest.metadata, status: "todo" },
            }}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const accept = await screen.findByRole("button", {
      name: "Accept the quest",
    });
    await waitFor(() =>
      expect(accept.getAttribute("title")).toBe(
        "Epic 7 is not ready for development yet.",
      ),
    );
    expect((accept as HTMLButtonElement).disabled).toBe(true);
  });
  it("unassigns from the Assigned picker, through the rail's Unassign and its confirmation (#Q3758)", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    // Read by the quest rail (#E154), so it must exist before the lock.
    alepha.inject(ResourceRailRegistry);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    const fake = alepha.inject(FakeLinkProvider);
    const ada = "00000000-0000-4000-8000-0000000000a1";
    fake.users = [{ id: ada, username: "ada" }];
    const quest = { ...fake.quest(), acceptedBy: ada };

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <QuestView quest={quest} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const picker = await screen.findByTestId("quest-assignee-picker");
    await waitFor(() =>
      expect((picker as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(picker);
    const entry = await screen.findByTestId("quest-assignee-unassign");
    expect(entry.textContent).toBe("Unassigned");
    fireEvent.click(entry);

    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Unassign" }));
    await waitFor(() => expect(fake.unassignCalls).toBe(1));
  });

  it("offers Answer in the composer only on a quest tagged needs-answer (#Q4348)", async () => {
    const mount = async (tags: string[]) => {
      alepha = Alepha.create()
        .with(AlephaLogger)
        .with(AlephaDateTime)
        .with(AlephaFake)
        .with({ provide: LinkProvider, use: FakeLinkProvider })
        .with(AlephaReact)
        .with(AlephaReactRouter)
        .with(AlephaReactI18n);
      alepha.inject(Routes);
      alepha.inject(I18n);
      alepha.inject(WorkShell);
      alepha.inject(ResourceRailRegistry);
      alepha.inject(PinnedPromptsSlot);
      await alepha.start();
      await alepha.inject(I18nProvider).setLang("en");
      alepha.store.set(currentProjectAtom, projectFixture());
      const fake = alepha.inject(FakeLinkProvider);
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <DialogProvider>
            <QuestView quest={{ ...fake.quest(), tags }} />
          </DialogProvider>
        </AlephaContext.Provider>,
      );
      // The composer's own button: the page has mounted it.
      await screen.findByRole("button", { name: "Comment" });
      return view;
    };

    const tagged = await mount(["needs-answer"]);
    // Nothing typed yet, so there is nothing to answer with.
    const answer = screen.getByRole("button", { name: "Answer" });
    expect((answer as HTMLButtonElement).disabled).toBe(true);
    tagged.unmount();
    await alepha?.stop();

    await mount(["bug"]);
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
  });

  it("offers no Unassigned entry on a quest nobody holds", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    alepha.inject(WorkShell);
    // Read by the quest rail (#E154), so it must exist before the lock.
    alepha.inject(ResourceRailRegistry);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    const fake = alepha.inject(FakeLinkProvider);
    fake.users = [
      { id: "00000000-0000-4000-8000-0000000000a1", username: "ada" },
    ];
    const quest = fake.quest();

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <QuestView
            quest={{
              ...quest,
              acceptedAt: undefined,
              acceptedBy: undefined,
              metadata: { ...quest.metadata, status: "todo" },
            }}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const picker = await screen.findByTestId("quest-assignee-picker");
    await waitFor(() =>
      expect((picker as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(picker);
    await screen.findByTestId("quest-assignee-option");
    expect(screen.queryByTestId("quest-assignee-unassign")).toBeNull();
  });
});
