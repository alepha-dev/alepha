import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import ProjectEpic from "./ProjectEpic.tsx";

const epicOf = (id: number): EpicResource =>
  ({
    id,
    number: id,
    projectId: 1,
    title: `Epic ${id}`,
    description: "",
    status: "draft",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
  }) as unknown as EpicResource;

const questOf = (id: number): QuestResource =>
  ({
    id,
    shortId: id,
    title: `Quest ${id}`,
    area: "lore/ui",
    metadata: { status: "todo" },
  }) as unknown as QuestResource;

/**
 * Answers the second epic at once, and holds the first epic's quests until
 * the case lets them go.
 */
class FakeLinkProvider extends LinkProvider {
  release: () => void = () => {};
  // One gate for the whole provider: `client()` is called once per
  // `useClient`, and a gate built per call would release the wrong one.
  held = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const held = this.held;
    return virtualClientFake({
      getQuests: async (request: {
        query: { epic: number; status?: string };
      }) => {
        if (request.query.status === "shelved") return { content: [] };
        if (request.query.epic === 1) {
          await held;
          return { content: [questOf(11), questOf(12), questOf(13)] };
        }
        return { content: [questOf(21)] };
      },
      list: async () => [],
    });
  }
}

/**
 * `ProjectEpic` reads an epic's quests through a `useQuery` keyed on the epic
 * (#E59, #Q2326). The effect it replaced had no race guard: moving from one
 * epic to the next while the first one's quests were still on their way let
 * them land on the second epic's page.
 */
describe("ProjectEpic", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const questCount = () =>
    screen
      .getByRole("radio", { name: /Quests/ })
      .querySelector('[data-slot="segmented-count"]')?.textContent;

  it("never shows the previous epic's quests after moving to the next one", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture() as never);
    const fake = alepha.inject(FakeLinkProvider);
    const app = alepha;

    const page = (epic: EpicResource) => (
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <ProjectEpic epic={epic} />
        </DialogProvider>
      </AlephaContext.Provider>
    );

    const view = render(page(epicOf(1)));
    await screen.findByRole("radio", { name: /Quests/ });
    // The first epic's quests are still on their way.
    expect(questCount()).toBeUndefined();

    view.rerender(page(epicOf(2)));
    await waitFor(() => expect(questCount()).toBe("1"));

    // The first epic's answer lands late, on the second epic's page.
    fake.release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(questCount()).toBe("1");
  });
});

/**
 * Edit opens the title and description sheet, and the page offers it only
 * while the plan is open (#Q2353): a started or completed epic's plan is
 * frozen. The server keeps accepting the update in every status; that half is
 * `EpicController.spec.ts`'s.
 */
describe("ProjectEpic, the Edit button", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (status: EpicResource["status"]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture() as never);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectEpic epic={{ ...epicOf(5), status } as EpicResource} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    // The header has rendered once the tab bar has.
    await screen.findByRole("radio", { name: /Quests/ });
  };

  const edit = () => screen.queryByRole("button", { name: "Edit" });

  it.each(["draft", "ready"] as const)(
    "offers Edit on a %s epic",
    async (status) => {
      await mount(status);
      expect(edit()).not.toBeNull();
    },
  );

  it.each(["in_progress", "completed"] as const)(
    "does not offer Edit on an %s epic",
    async (status) => {
      await mount(status);
      expect(edit()).toBeNull();
    },
  );
});
