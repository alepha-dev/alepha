import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { currentAreasAtom } from "../../../atoms/currentAreasAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectEpicQuests from "./ProjectEpicQuests.tsx";

const questOf = (
  shortId: number,
  title: string,
  priority: QuestResource["priority"],
): QuestResource =>
  ({
    id: shortId,
    shortId,
    projectId: 1,
    title,
    description: "",
    priority,
    size: 1,
    tags: [],
    objectives: [],
    attachments: [],
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    metadata: {
      status: "new",
      objectivesProgress: { completed: 0, waived: 0, total: 0 },
      totalTimeSpent: 0,
    },
  }) as unknown as QuestResource;

/**
 * The epic the tab belongs to. Only its status matters here: the quest set
 * is editable while `planned` and frozen otherwise (epic #31).
 */
const epicOf = (status: EpicResource["status"]): EpicResource =>
  ({
    id: 7,
    number: 7,
    projectId: 1,
    title: "The initiative",
    description: "",
    status,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
    questCount: 0,
  }) as unknown as EpicResource;

/**
 * Stands in for the HTTP-backed `useClient()` calls the create sheet makes.
 * Same substitution seam as `ProjectQuestsTable.browser.spec.tsx`.
 */
class FakeLinkProvider extends LinkProvider {
  created: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const action = <T extends (...args: any[]) => Promise<unknown>>(fn: T) =>
      Object.assign(fn, { can: () => true });
    return new Proxy(
      {
        createQuest: action(async (config: { body: { title: string } }) => {
          this.created.push(config.body.title);
          return questOf(99, config.body.title, "medium");
        }),
      } as Record<string, unknown>,
      {
        get: (target, prop: string) =>
          target[prop] ??
          action(async () => Object.assign([], { content: [], items: [] })),
      },
    );
  }
}

/**
 * The quest page, so the anchor has something to resolve against. The real
 * `AppRouter` is not mounted: the table only needs the one route name and
 * its shape.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/quests/:shortId",
    component: () => null,
  });
}

/**
 * The epic's Quests tab, in the shape the Quests list has (feedback #2062):
 * number and title in one anchor with the dash muted, then the priority and
 * the last update, which are what a reader scans a quest list for.
 */
describe("ProjectEpicQuests - columns", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    // The create sheet mounts a segmented control that measures itself with
    // a ResizeObserver jsdom does not have.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    quests: QuestResource[],
    status: EpicResource["status"] = "planned",
  ) => {
    alepha = Alepha.create()
      .with(AlephaDateTime)
      // Before the modules that reach for it: `AlephaReactRouter`
      // instantiates `LinkProvider`, and a substitution after that is too
      // late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    // The real catalogue: the headers are asserted by the words a reader
    // sees, not by their keys.
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    // The create sheet reads the project and the areas from the atoms the
    // project route fills; both validate against their full schemas.
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Lore",
      slug: "lore",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      // Empty until the surfaces read capabilities: this spec is
      // about something else, and a fixture that claims capabilities it
      // does not exercise is a lie the next reader has to check.
      capabilities: [],
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);
    alepha.store.set(currentAreasAtom, [
      {
        id: 1,
        projectId: 1,
        name: "General",
        description: "",
        createdAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:00.000Z",
        questCount: 0,
        openQuestCount: 0,
        recentQuests: [],
      },
    ] as never);
    const detached: number[] = [];
    const created: number[] = [];
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectEpicQuests
            projectId={1}
            epic={epicOf(status)}
            quests={quests}
            onAttach={() => undefined}
            onDetach={(quest) => detached.push(quest.shortId)}
            onCreated={(quest) => {
              created.push(quest.id);
            }}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return {
      view,
      detached,
      created,
      links: alepha.inject(FakeLinkProvider),
    };
  };

  it("renders number and title as one anchor to the quest, with the dash muted", async () => {
    await mount([questOf(12, "Ship the thing", "high")]);

    const link = await screen.findByRole("link", {
      name: "#Q12 - Ship the thing",
    });
    expect(link.getAttribute("href")).toBe("/quests/12");
    // Only the separator is muted: the number carries the title's colour.
    const dash = link.querySelector("span.text-muted-foreground");
    expect(dash?.textContent).toBe("-");
    // The old standalone number column is gone.
    expect(screen.queryByRole("columnheader", { name: "#" })).toBeNull();
  });

  it("shows the priority chip and the relative update time under their own headers", async () => {
    await mount([questOf(12, "Ship the thing", "high")]);

    await screen.findByRole("link", { name: "#Q12 - Ship the thing" });
    expect(screen.getByText("Priority")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    // dayjs relative time, whatever the clock says: "ago" is the shape.
    expect(screen.getByText(/ago$/)).toBeTruthy();
  });

  it("keeps the detach row action", async () => {
    const { detached } = await mount([questOf(12, "Ship the thing", "low")]);

    await screen.findByRole("link", { name: "#Q12 - Ship the thing" });
    // The row menu is a per-row control; the action inside it is the one
    // named in the catalogue.
    const menus = screen.getAllByRole("button", { name: /actions|menu/i });
    expect(menus.length).toBeGreaterThan(0);
    expect(detached).toEqual([]);
  });

  /**
   * The plan freeze (epic #31). Once the epic has begun the server refuses
   * attach, detach and create-into, so the affordances go with the
   * permission instead of answering 400: no New Quest, no Attach Quest, and
   * no row menu, since Detach was the only entry in it.
   */
  it("hides Create, Attach and Detach once the plan is frozen", async () => {
    for (const status of ["active", "done"] as const) {
      const { view } = await mount(
        [questOf(12, "Ship the thing", "low")],
        status,
      );

      await screen.findByRole("link", { name: "#Q12 - Ship the thing" });
      expect(screen.queryByRole("button", { name: "New Quest" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Attach Quest" })).toBeNull();
      expect(
        screen.queryAllByRole("button", { name: /actions|menu/i }),
      ).toEqual([]);

      view.unmount();
      await alepha?.stop();
      alepha = undefined;
    }
  });
  /**
   * New Quest beside Attach Quest (feedback #2057): the same sheet the
   * header opens, and the new quest is handed to the page through
   * `onCreated` so the page can file it under the epic and reload, rather
   * than the sheet navigating away to the quest it just made.
   */
  it("creates a quest from the toolbar and hands it to the page", async () => {
    const { view, created, links } = await mount([
      questOf(12, "Ship the thing", "low"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "New Quest" }));
    const sheet = await view.findByRole("dialog");
    expect(sheet.textContent).toContain("New Quest");

    const title = await waitFor(() => {
      const input = sheet.querySelector<HTMLInputElement>(
        'input[name="title"]',
      );
      expect(input).not.toBeNull();
      return input!;
    });
    fireEvent.change(title, { target: { value: "Quest for the epic" } });
    const area = within(sheet).getAllByRole("combobox")[0]!;
    fireEvent.keyDown(area, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /General/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add Quest to Project" }),
    );

    await waitFor(() => expect(links.created).toEqual(["Quest for the epic"]));
    // The page, not the sheet, files it: `onCreated` carries the quest and
    // the sheet closes instead of navigating.
    await waitFor(() => expect(created).toEqual([99]));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  });
});
