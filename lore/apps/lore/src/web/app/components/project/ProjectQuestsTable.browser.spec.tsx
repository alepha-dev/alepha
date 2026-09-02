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
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { currentAreasAtom } from "../../atoms/currentAreasAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../services/I18n.ts";
import ProjectQuestsTable from "./ProjectQuestsTable.tsx";

const questOf = (id: number, title: string, shelved = false): QuestResource =>
  ({
    id,
    shortId: id,
    projectId: 1,
    title,
    description: "",
    priority: "medium",
    size: 1,
    tags: [],
    objectives: [],
    attachments: [],
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    shelvedAt: shelved ? "2026-09-02T11:00:00.000Z" : undefined,
    metadata: {
      status: shelved ? "shelved" : "new",
      objectivesProgress: { completed: 0, waived: 0, total: 0 },
      totalTimeSpent: 0,
    },
  }) as unknown as QuestResource;

/**
 * Stands in for the HTTP-backed `useClient()` calls the table and the
 * create sheet make. Same substitution seam as
 * `ProjectFeedbackDetail.browser.spec.tsx` (`CLAUDE.md`: never `vi.mock` /
 * `vi.spyOn`). `quests` is the list the fake serves, and `createQuest`
 * appends to it, so a refetch after a creation sees the new row exactly
 * as the server would show it.
 */
class FakeLinkProvider extends LinkProvider {
  quests: QuestResource[] = [questOf(1, "Existing quest")];
  created: string[] = [];
  fetches = 0;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const page = () => ({
      content: [...this.quests],
      totalElements: this.quests.length,
      totalPages: 1,
      number: 0,
      numberOfElements: this.quests.length,
    });
    // Every action carries `can()`, the way the real client's do: the table
    // gates its row actions and the create action through it.
    const action = <T extends (...args: any[]) => Promise<unknown>>(fn: T) =>
      Object.assign(fn, { can: () => true });
    return new Proxy(
      {
        getQuests: action(async () => {
          this.fetches += 1;
          return page();
        }),
        createQuest: action(async (config: { body: { title: string } }) => {
          const quest = questOf(this.quests.length + 1, config.body.title);
          this.quests.push(quest);
          this.created.push(config.body.title);
          return quest;
        }),
      } as Record<string, unknown>,
      {
        get: (target, prop: string) =>
          target[prop] ??
          // An empty array carrying `content` / `items` so it satisfies
          // callers that map the response and callers that unwrap a page.
          action(async () => Object.assign([], { content: [], items: [] })),
      },
    );
  }
}

/**
 * The quest page, so the row anchors have something to resolve against. The
 * real `AppRouter` is not mounted: the table only needs the one route name
 * and its shape.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/quests/:shortId",
    component: () => null,
  });
}

/**
 * The Quests table's own create control (feedback #2060): a labelled primary
 * action in the toolbar, next to the utility icons, opening the same sheet
 * the header's create button opens. The new quest has to show up in the
 * list without leaving it, which is the opposite of what the sheet does on
 * its own (it navigates to the quest it just made).
 */
describe("ProjectQuestsTable - toolbar create action and bulk bar", () => {
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

  const mount = async (initial?: QuestResource[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it: `AlephaReactRouter`
      // instantiates `LinkProvider`, and a substitution after that is too
      // late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    // The real catalogue, so the button is found by the words a reader
    // sees rather than by a key.
    alepha.inject(I18n);
    await alepha.start();
    if (initial) {
      alepha.inject(FakeLinkProvider).quests = initial;
    }
    await alepha.inject(I18nProvider).setLang("en");
    // The atom validates against `projectResourceSchema`, so this is the
    // whole required shape, not a convenient subset.
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Lore",
      slug: "lore",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);
    // One area, so the create form has something to pick: `area` is
    // required and the form seeds nothing when no quest is being edited.
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
    // Two releases, so the release filter renders: it is gated on the project
    // HAVING releases, not on the option list being non-empty - "No release"
    // is always in that list and would otherwise show the filter to a project
    // with nothing to filter by.
    const aRelease = (id: number, number: number, tag: string) => ({
      id,
      projectId: 1,
      number,
      tag,
      title: tag,
      description: "",
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
    });
    alepha.store.set(currentReleasesAtom, [
      aRelease(7, 1, "0.28.0"),
      aRelease(8, 2, "0.29.0"),
    ] as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectQuestsTable />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await view.findByRole("link", { name: /^#1 - / });
    return { view, links: alepha.inject(FakeLinkProvider) };
  };

  it("renders a labelled primary New Quest action in the toolbar", async () => {
    const { view } = await mount();

    const button = screen.getByRole("button", { name: "New Quest" });
    // The label is on the button, not only in a tooltip that opens later,
    // and the surface is the primary one: the bare `+` feedback #2055 saw
    // was this control at the weight of the column picker.
    expect(button.textContent).toBe("New Quest");
    expect(button.className).toContain("bg-primary");
    // The divider the table draws between its actions and the utility
    // icons, which only exists once there is an action to divide from.
    expect(
      view.container.querySelector("span[aria-hidden].w-px.bg-border"),
    ).not.toBeNull();
  });

  it("opens the create sheet, and the created quest lands in the list without leaving it", async () => {
    const { view, links } = await mount();
    const fetchesBefore = links.fetches;

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
    fireEvent.change(title, { target: { value: "Quest from the toolbar" } });
    // The area combobox: open it and take the one option. Its popup is a
    // portal, so the option is found on the document, not in the sheet.
    const area = within(sheet).getAllByRole("combobox")[0]!;
    fireEvent.keyDown(area, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /General/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add Quest to Project" }),
    );

    await waitFor(() =>
      expect(links.created).toEqual(["Quest from the toolbar"]),
    );
    // The sheet closes, the list refetches, and the row is there: no
    // navigation to the quest's own page.
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await view.findByRole("link", { name: "#2 - Quest from the toolbar" });
    expect(links.fetches).toBeGreaterThan(fetchesBefore);
    expect(
      alepha!.store.get("alepha.react.router.state" as never) as
        | { name?: string }
        | undefined,
    ).not.toMatchObject({ name: "projectQuest" });
  });
  /**
   * The bulk bar's Shelve and Unshelve (feedback #2063): each is offered
   * only for a selection it can act on, and a mixed selection gets both.
   * Hidden rather than disabled, the way the `Unshelve` row action only
   * exists on shelved rows.
   */
  // The row's accessible name is its cells run together, starting with the
  // checkbox's own "Select row"; the checkbox itself is only "Select row".
  const selectRow = (shortId: number) => {
    const row = screen.getByRole("row", {
      name: new RegExp(`^Select row - #${shortId} `),
    });
    fireEvent.click(within(row).getByRole("checkbox"));
  };

  const shelved = () => screen.queryByRole("button", { name: "Shelve" });
  const unshelved = () => screen.queryByRole("button", { name: "Unshelve" });

  const mixed = () => [
    questOf(1, "Open quest"),
    questOf(2, "Parked quest", true),
  ];

  it("offers Shelve and not Unshelve when nothing selected is shelved", async () => {
    await mount(mixed());

    selectRow(1);

    await waitFor(() => expect(shelved()).not.toBeNull());
    expect(unshelved()).toBeNull();
  });

  it("offers Unshelve and not Shelve when everything selected is shelved", async () => {
    await mount(mixed());

    selectRow(2);

    await waitFor(() => expect(unshelved()).not.toBeNull());
    expect(shelved()).toBeNull();
  });

  it("offers both for a mixed selection", async () => {
    await mount(mixed());

    selectRow(1);
    selectRow(2);

    await waitFor(() => expect(shelved()).not.toBeNull());
    expect(unshelved()).not.toBeNull();
    // The third action does not depend on the selection.
    expect(screen.getByRole("button", { name: /Add to release/ })).toBeTruthy();
  });

  /**
   * "What is still unassigned" is the question a release planner asks most,
   * and every option being a release left it unanswerable (#1700). The
   * option leads the list rather than trailing it: it is the one people
   * reach for, and it is not a release.
   */
  it("leads the release filter with No release", async () => {
    const { view } = await mount();

    fireEvent.click(view.getByRole("combobox", { name: "Release" }));

    const options = await waitFor(() => {
      const found = view.baseElement.querySelectorAll('[role="option"]');
      if (found.length === 0) throw new Error("not open yet");
      return [...found].map((option) => option.textContent);
    });

    expect(options[0]).toContain("No release");
    expect(options.join(" ")).toContain("0.28.0");
    // "None" reads as "no filter" in a filter; the label has to say which.
    expect(options[0]).not.toBe("None");
  });
});
