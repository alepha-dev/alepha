import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "@/api/schemas/questResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import QuestView from "./QuestView.tsx";

/**
 * Refuses the shelve, and answers every read the page makes with nothing.
 */
class FakeLinkProvider extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  shelveCalls = 0;

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
      getProjectUsers: async () => [],
      listQuestTags: async () => [],
      getEpics: async () => [],
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
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture() as never);
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
});
