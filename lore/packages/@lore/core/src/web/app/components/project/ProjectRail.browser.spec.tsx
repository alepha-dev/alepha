import { act, cleanup, render, screen } from "@testing-library/react";
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
import { recentProjectsAtom } from "../../atoms/recentProjectsAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { I18n } from "../../services/I18n.ts";
import ProjectRail from "./ProjectRail.tsx";

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({});
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
 * The project rail (#Q3366): two projects or more, at most ten, the ones this
 * browser opened last first, and the current one recorded as opened.
 */
describe("ProjectRail", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    projects: ReturnType<typeof row>[],
    currentId: number,
    opened: number[] = [],
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
      canCreate: true,
    });
    alepha.store.set(recentProjectsAtom, opened);

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

  it("is absent with a single project", async ({ expect }) => {
    await mount([row(1, "Lore", "2026-01-01")], 1);

    expect(screen.queryByTestId("project-rail")).toBeNull();
  });

  it("is absent when the only other project is archived", async ({
    expect,
  }) => {
    await mount(
      [row(1, "Lore", "2026-01-01"), row(2, "Old", "2026-01-02", "2026-02-01")],
      1,
    );

    expect(screen.queryByTestId("project-rail")).toBeNull();
  });

  it("orders by opened, then by update, and marks the current one", async ({
    expect,
  }) => {
    await mount(
      [
        row(1, "Lore", "2026-01-03"),
        row(2, "Club", "2026-01-02"),
        row(3, "Acme", "2026-01-01"),
      ],
      2,
      [3],
    );

    expect(titles()).toEqual(["Acme", "Lore", "Club"]);
    const current = screen
      .getAllByTestId("project-rail-item")
      .find((it) => it.getAttribute("aria-current") === "page");
    expect(current?.getAttribute("aria-label")).toBe("Club");
    expect(screen.getByTestId("project-rail-all")).toBeTruthy();
  });

  it("shows at most ten, and draws initials without an icon", async ({
    expect,
  }) => {
    const projects = Array.from({ length: 12 }, (_, i) =>
      row(i + 1, `Project ${i + 1}`, `2026-01-${String(30 - i)}`),
    );
    await mount(projects, 12);

    expect(titles()).toHaveLength(10);
    expect(titles()).toContain("Project 12");
    expect(screen.getAllByTestId("project-monogram")[0].textContent).toBe("P1");
  });

  it("keeps the order when a project is selected", async ({ expect }) => {
    const app = await mount(
      [
        row(1, "Lore", "2026-01-03"),
        row(2, "Club", "2026-01-02"),
        row(3, "Acme", "2026-01-01"),
      ],
      1,
    );

    // The first order is by update, and it is stored as shown.
    expect(titles()).toEqual(["Lore", "Club", "Acme"]);
    expect(app.store.get(recentProjectsAtom)).toEqual([1, 2, 3]);

    // Selecting Acme moves nothing, now or on the next load.
    act(() => {
      app.store.set(currentProjectAtom, row(3, "Acme", "2026-01-01"));
    });
    expect(titles()).toEqual(["Lore", "Club", "Acme"]);
    expect(app.store.get(recentProjectsAtom)).toEqual([1, 2, 3]);
  });

  it("gives a project opened from outside the rail the last slot", async ({
    expect,
  }) => {
    const projects = Array.from({ length: 11 }, (_, i) =>
      row(i + 1, `Project ${i + 1}`, `2026-01-${String(30 - i)}`),
    );
    const app = await mount(projects, 11, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    expect(titles().at(-1)).toBe("Project 11");
    expect(app.store.get(recentProjectsAtom)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 11,
    ]);
  });
});
