import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userDockAtom } from "../../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { I18n } from "../../services/I18n.ts";
import ProjectRail from "./ProjectRail.tsx";

/**
 * The dock actions the reorder specs answer, and what they were sent.
 */
const dockApi = {
  saved: [] as number[][],
  fail: false,
  reorderDock: async (input: { body: { projectIds: number[] } }) => {
    dockApi.saved.push(input.body.projectIds);
    if (dockApi.fail) throw new Error("refused");
    return { projectIds: input.body.projectIds };
  },
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({ reorderDock: dockApi.reorderDock });
  }
}

class Routes {
  home = $page({ name: "home", path: "/", component: () => null });
  project = $page({
    name: "project",
    path: "/:projectSlug",
    component: () => null,
  });
  accountProjects = $page({
    name: "accountProjects",
    path: "/account/projects",
    component: () => null,
  });
  projectCreate = $page({
    name: "projectCreate",
    path: "/new-project",
    component: () => null,
  });
}

const row = (
  id: number,
  title: string,
  updatedAt: string,
  archivedAt?: string,
) => ({
  ...projectFixture({ id, title, slug: title.toLowerCase() }),
  updatedAt: `${updatedAt}T00:00:00.000Z`,
  areaCount: 0,
  openQuestCount: 0,
  owner: true,
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  archivedAt: archivedAt ? `${archivedAt}T00:00:00.000Z` : undefined,
});

/**
 * The dock (#Q3366, #E139 #Q3437): the pinned projects in dock order, a faded
 * temporary slot for an unpinned current project, and Home, New project and
 * All projects fixed at the ends.
 */
describe("ProjectRail", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    dockApi.saved = [];
    dockApi.fail = false;
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    projects: ReturnType<typeof row>[],
    currentId: number,
    dock: number[] = projects.map((it) => it.id),
    canCreate = true,
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    alepha.store.set(
      currentProjectAtom,
      projects.find((it) => it.id === currentId),
    );
    alepha.store.set(userProjectsAtom, {
      projects,
      totalCount: projects.length,
      ownedCount: projects.length,
      maxProjects: 50,
      canCreate,
    });
    alepha.store.set(userDockAtom, dock);

    render(
      <AlephaContext.Provider value={alepha}>
        <ProjectRail />
      </AlephaContext.Provider>,
    );
    return alepha;
  };

  const titles = () =>
    screen
      .queryAllByTestId("project-rail-item")
      .map((it) => it.getAttribute("aria-label"));

  it("shows from a single project, with Home, New project and All projects", async ({
    expect,
  }) => {
    await mount([row(1, "Lore", "2026-01-01")], 1);

    expect(screen.getByTestId("project-rail")).toBeTruthy();
    expect(titles()).toEqual(["Lore"]);
    expect(screen.getByTestId("project-rail-home").getAttribute("href")).toBe(
      "/",
    );
    expect(
      screen.getByTestId("project-rail-create").getAttribute("href"),
    ).toBeTruthy();
    expect(screen.getByTestId("project-rail-all")).toBeTruthy();
  });

  it("leaves an archived project out", async ({ expect }) => {
    await mount(
      [row(1, "Lore", "2026-01-01"), row(2, "Old", "2026-01-02", "2026-02-01")],
      1,
    );

    expect(titles()).toEqual(["Lore"]);
  });

  it("disables New project once the quota is reached", async ({ expect }) => {
    await mount([row(1, "Lore", "2026-01-01")], 1, [1], false);

    const create = screen.getByTestId("project-rail-create");
    expect(create.getAttribute("href")).toBeNull();
    expect(create.getAttribute("aria-disabled")).toBe("true");
    expect(create.getAttribute("aria-label")).toContain("50");
  });

  it("draws the pins in dock order, not by update, and marks the current one", async ({
    expect,
  }) => {
    await mount(
      [
        row(1, "Lore", "2026-01-03"),
        row(2, "Club", "2026-01-02"),
        row(3, "Acme", "2026-01-01"),
      ],
      2,
      [3, 1, 2],
    );

    expect(titles()).toEqual(["Acme", "Lore", "Club"]);
    const current = screen
      .getAllByTestId("project-rail-item")
      .find((it) => it.getAttribute("aria-current") === "page");
    expect(current?.getAttribute("aria-label")).toBe("Club");
    expect(screen.queryByTestId("project-rail-temporary")).toBeNull();
  });

  it("draws up to twenty pins, and initials without an icon", async ({
    expect,
  }) => {
    const projects = Array.from({ length: 20 }, (_, i) =>
      row(i + 1, `Project ${i + 1}`, `2026-01-${String(30 - i)}`),
    );
    await mount(projects, 20);

    expect(titles()).toHaveLength(20);
    expect(screen.getAllByTestId("project-monogram")[0].textContent).toBe("P1");
  });

  it("shows an unpinned current project in a faded temporary slot below the pins", async ({
    expect,
  }) => {
    await mount(
      [row(1, "Lore", "2026-01-03"), row(2, "Club", "2026-01-02")],
      2,
      [1],
    );

    expect(titles()).toEqual(["Lore"]);
    const slot = screen.getByTestId("project-rail-temporary");
    expect(slot.getAttribute("aria-label")).toBe("Club");
    expect(slot.getAttribute("aria-current")).toBe("page");
    expect(slot.className).toContain("opacity-50");
    // Below the pins, inside the scrolling middle.
    const pins = screen.getByTestId("project-rail-pins");
    expect(pins.lastElementChild?.firstElementChild).toBe(slot);
  });

  it("keeps the fixed buttons with no pins at all", async ({ expect }) => {
    await mount([row(1, "Lore", "2026-01-01")], 1, []);

    expect(titles()).toEqual([]);
    expect(screen.getByTestId("project-rail-temporary")).toBeTruthy();
    expect(screen.getByTestId("project-rail-home")).toBeTruthy();
    expect(screen.getByTestId("project-rail-create")).toBeTruthy();
    expect(screen.getByTestId("project-rail-all")).toBeTruthy();
  });

  it("keeps the order when a project is selected, and drops the temporary slot", async ({
    expect,
  }) => {
    const app = await mount(
      [
        row(1, "Lore", "2026-01-03"),
        row(2, "Club", "2026-01-02"),
        row(3, "Acme", "2026-01-01"),
      ],
      3,
      [1, 2],
    );
    expect(screen.getByTestId("project-rail-temporary")).toBeTruthy();

    await act(async () => {
      app.store.set(currentProjectAtom, row(1, "Lore", "2026-01-03"));
    });
    expect(titles()).toEqual(["Lore", "Club"]);
    expect(screen.queryByTestId("project-rail-temporary")).toBeNull();
    expect(app.store.get(userDockAtom)).toEqual([1, 2]);
  });

  it("ignores dock ids that are no longer a membership", async ({ expect }) => {
    await mount([row(1, "Lore", "2026-01-01")], 1, [99, 1]);
    expect(titles()).toEqual(["Lore"]);
  });

  describe("keyboard reorder (#Q3438)", () => {
    const three = () => [
      row(1, "Lore", "2026-01-03"),
      row(2, "Club", "2026-01-02"),
      row(3, "Acme", "2026-01-01"),
    ];
    const item = (title: string) =>
      screen
        .getAllByTestId("project-rail-item")
        .find((it) => it.getAttribute("aria-label") === title)!;

    it("picks up with Space, moves with the arrows, and saves on the drop", async ({
      expect,
    }) => {
      const app = await mount(three(), 1, [1, 2, 3]);
      const club = item("Club");
      club.focus();

      fireEvent.keyDown(club, { key: " " });
      expect(item("Club").getAttribute("aria-pressed")).toBe("true");
      fireEvent.keyDown(item("Club"), { key: "ArrowUp" });
      expect(titles()).toEqual(["Club", "Lore", "Acme"]);
      // Drawn, not saved, until the drop.
      expect(dockApi.saved).toEqual([]);
      expect(document.activeElement).toBe(item("Club"));

      fireEvent.keyDown(item("Club"), { key: " " });
      await waitFor(() => expect(dockApi.saved).toEqual([[2, 1, 3]]));
      expect(app.store.get(userDockAtom)).toEqual([2, 1, 3]);
      expect(item("Club").getAttribute("aria-pressed")).toBeNull();
    });

    it("puts the order back on Escape, and saves nothing", async ({
      expect,
    }) => {
      const app = await mount(three(), 1, [1, 2, 3]);
      fireEvent.keyDown(item("Acme"), { key: " " });
      fireEvent.keyDown(item("Acme"), { key: "ArrowUp" });
      fireEvent.keyDown(item("Acme"), { key: "ArrowUp" });
      expect(titles()).toEqual(["Acme", "Lore", "Club"]);

      fireEvent.keyDown(item("Acme"), { key: "Escape" });
      expect(titles()).toEqual(["Lore", "Club", "Acme"]);
      expect(app.store.get(userDockAtom)).toEqual([1, 2, 3]);
      expect(dockApi.saved).toEqual([]);
    });

    it("rolls the order back when the save is refused", async ({ expect }) => {
      dockApi.fail = true;
      const app = await mount(three(), 1, [1, 2, 3]);
      fireEvent.keyDown(item("Club"), { key: " " });
      fireEvent.keyDown(item("Club"), { key: "ArrowDown" });
      fireEvent.keyDown(item("Club"), { key: "Enter" });

      await waitFor(() => expect(dockApi.saved).toEqual([[1, 3, 2]]));
      await waitFor(() =>
        expect(app.store.get(userDockAtom)).toEqual([1, 2, 3]),
      );
      expect(titles()).toEqual(["Lore", "Club", "Acme"]);
    });

    it("leaves the temporary slot out of the reorder", async ({ expect }) => {
      await mount(three(), 3, [1, 2]);
      const slot = screen.getByTestId("project-rail-temporary");
      expect(slot.getAttribute("aria-describedby")).toBeNull();
      fireEvent.keyDown(slot, { key: " " });
      expect(slot.getAttribute("aria-pressed")).toBeNull();
    });

    it("lets a plain click through", async ({ expect }) => {
      await mount(three(), 1, [1, 2, 3]);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      item("Club").dispatchEvent(event);
      // The router may take the click; what matters is that the drop guard
      // did not stop it from reaching it.
      expect(item("Club").getAttribute("href")).toBe("/club");
      expect(event.cancelBubble).toBe(false);
    });
  });
});
