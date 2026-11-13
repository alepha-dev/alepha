import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { currentProjectAtom, ResourceTabRegistry, I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import { WorkShell } from "../../../shell/WorkShell.ts";
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
  activityQueries: Array<Record<string, unknown>> = [];
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
      getProjectActivity: async (request: {
        query: Record<string, unknown>;
      }) => {
        this.activityQueries.push(request.query);
        return {
          content: [],
          page: {
            number: 0,
            size: 25,
            offset: 0,
            numberOfElements: 0,
            totalElements: 0,
            totalPages: 1,
            isEmpty: true,
            isFirst: true,
            isLast: true,
          },
        };
      },
      getProjectUsers: async () => [],
      getProjectActivityFilters: async () => ({ types: [], actions: [] }),
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
    // The tabs other modules add here (#E75, #Q2624); none in this spec.
    alepha.inject(ResourceTabRegistry);
    // Work registers the agent prompt kinds the page offers (#E75, #Q2624).
    alepha.inject(WorkShell);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
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

    // Activity is loaded only when its shareable tab is selected, and the
    // request uses the epic number recorded on audit rows rather than its id.
    expect(fake.activityQueries).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: "Activity" }));
    await waitFor(() => expect(fake.activityQueries).toHaveLength(1));
    expect(fake.activityQueries[0]).toMatchObject({
      resourceType: "epic",
      resourceId: "2",
    });
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
    // The tabs other modules add here (#E75, #Q2624); none in this spec.
    alepha.inject(ResourceTabRegistry);
    // Work registers the agent prompt kinds the page offers (#E75, #Q2624).
    alepha.inject(WorkShell);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());

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

/**
 * The epic page's Agent Prompts > Work on it on a draft epic (#Q3583): it
 * marks the epic ready with the copy, so it asks first, and the confirm's own
 * click copies and marks, as on the epics list.
 */
describe("ProjectEpic, Work on it on a draft epic", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * The epic page, which the prompt's link resolves against.
   */
  class Routes {
    epic = $page({
      name: "projectEpic",
      path: "/:projectSlug/epics/:epicNumber",
      component: () => null,
    });
  }

  class StatusLinks extends FakeLinkProvider {
    statusCalls: string[] = [];

    override client(): any {
      const base = super.client();
      return new Proxy(base, {
        get: (target, key: string) =>
          key === "setEpicStatus"
            ? Object.assign(
                async (request: { body: { status: string } }) => {
                  this.statusCalls.push(request.body.status);
                  return { ...epicOf(5), status: request.body.status };
                },
                { can: () => true },
              )
            : target[key],
      });
    }
  }

  const mount = async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: StatusLinks })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    alepha.inject(ResourceTabRegistry);
    alepha.inject(WorkShell);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <ProjectEpic epic={epicOf(5)} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByRole("radio", { name: /Quests/ });
    return { written, fake: alepha.inject(StatusLinks) };
  };

  const workOnIt = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Agent Prompts" }));
    const item = await screen.findByRole("menuitem", { name: "Work on it" });
    fireEvent.click(item);
    return await screen.findByRole("alertdialog");
  };

  it("asks first, then copies and marks the epic ready in the confirm's click", async () => {
    const { written, fake } = await mount();

    const confirm = await workOnIt();
    expect(confirm.textContent).toContain("Mark this epic ready?");
    expect(written).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy and mark ready" }),
    );

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toContain("#E5");
    await waitFor(() => expect(fake.statusCalls).toEqual(["ready"]));
  });

  it("does nothing when the confirm is cancelled", async () => {
    const { written, fake } = await mount();

    await workOnIt();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(written).toHaveLength(0);
    expect(fake.statusCalls).toEqual([]);
  });
});
