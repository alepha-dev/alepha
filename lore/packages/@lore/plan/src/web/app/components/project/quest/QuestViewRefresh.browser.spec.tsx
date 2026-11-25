import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  ResourceRailRegistry,
  PinnedPromptsSlot,
} from "@lore/core/web";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact, QueryCache } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "../../../../../api/schemas/questResourceSchema.ts";
import { WorkShell } from "../../../shell/WorkShell.ts";
import QuestView from "./QuestView.tsx";

let hidden = false;
Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => hidden,
});
const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};

/**
 * The server: the quest it answers on a read, which a spec moves, and how
 * many reads the page made.
 */
class FakeLinkProvider extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  public reads = 0;
  public commentReads = 0;
  public served?: QuestResource;

  override client(): any {
    return virtualClientFake({
      getQuestByShortId: async () => {
        this.reads++;
        return this.served;
      },
      getQuestLine: async () => ({ dependents: [] }),
      listQuestComments: async () => {
        this.commentReads++;
        return [];
      },
      listQuestAttachments: async () => [],
      getProjectUsers: async () => [],
      listQuestTags: async () => [],
      getEpicRefs: async () => [],
    });
  }

  public quest(
    status: QuestResource["metadata"]["status"],
    over: Partial<QuestResource> = {},
  ): QuestResource {
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
      updatedAt: "2026-08-26T10:00:00.000Z",
      attachments: [],
      objectives: [],
      timerSessions: [],
      metadata: { ...generated.metadata, status },
      ...over,
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
 * The quest page keeps itself current (#Q3860): it reads the quest again on
 * a tab return, and every 15 s only while the quest is in progress and the
 * page visible, never over an edit.
 */
describe("QuestView refresh", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    hidden = false;
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (status: QuestResource["metadata"]["status"]) => {
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
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
    const server = alepha.inject(FakeLinkProvider);
    const quest = server.quest(status);
    server.served = quest;
    // What the route loader does: the page's query starts fresh on it.
    alepha.inject(QueryCache).set(["quest", 1, 1], quest);

    const app = alepha;
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <QuestView quest={quest} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByRole("button", { name: "Edit" });
    const travel = (seconds: number) =>
      act(() => dateTime.travel([seconds, "seconds"]));
    return { server, travel };
  };

  it("asks nothing on mount, then polls every 15 s while in progress", async ({
    expect,
  }) => {
    const { server, travel } = await mount("in_progress");
    expect(server.reads).toBe(0);

    await travel(15);
    await waitFor(() => expect(server.reads).toBe(1));
    await travel(15);
    await waitFor(() => expect(server.reads).toBe(2));
  });

  it("sends no request while the document is hidden", async ({ expect }) => {
    const { server, travel } = await mount("in_progress");

    setHidden(true);
    await travel(15);
    await travel(15);
    await travel(15);
    expect(server.reads).toBe(0);

    // Back on the tab: the tab-return read, then the poll resumes.
    setHidden(false);
    await waitFor(() => expect(server.reads).toBe(1));
    await travel(15);
    await waitFor(() => expect(server.reads).toBe(2));
  });

  it("shows what changed, and stops the timer once the quest leaves in progress", async ({
    expect,
  }) => {
    const { server, travel } = await mount("in_progress");

    server.served = server.quest("completed", {
      title: "Shipped",
      completedAt: "2026-08-26T11:00:00.000Z",
      updatedAt: "2026-08-26T11:00:00.000Z",
    });
    await travel(15);
    await waitFor(() => expect(screen.getAllByText("Shipped").length).toBe(1));
    expect(server.reads).toBe(1);

    await travel(60);
    expect(server.reads).toBe(1);
  });

  it("re-reads the discussion with each refresh, on no timer of its own", async ({
    expect,
  }) => {
    const { server, travel } = await mount("in_progress");
    await waitFor(() => expect(server.commentReads).toBe(1));

    await travel(15);
    await waitFor(() => expect(server.reads).toBe(1));
    await waitFor(() => expect(server.commentReads).toBe(2));
  });

  it("has no timer for a quest that is not in progress, only the tab return", async ({
    expect,
  }) => {
    const { server, travel } = await mount("todo");

    await travel(60);
    expect(server.reads).toBe(0);

    setHidden(true);
    setHidden(false);
    await waitFor(() => expect(server.reads).toBe(1));
  });

  it("holds every refresh while the edit sheet is open", async ({ expect }) => {
    const { server, travel } = await mount("in_progress");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog");
    server.served = server.quest("in_progress", {
      title: "Renamed elsewhere",
      updatedAt: "2026-08-26T11:00:00.000Z",
    });

    await travel(60);
    setHidden(true);
    setHidden(false);
    await travel(1);
    expect(server.reads).toBe(0);
    expect(screen.queryByText("Renamed elsewhere")).toBeNull();
  });
});
