import {
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
import { userDockAtom } from "../../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { I18n } from "../../services/I18n.ts";
import MyProjects from "./MyProjects.tsx";

/**
 * The dock as the fake server holds it.
 */
const dockApi = {
  dock: [] as number[],
  pinProject: async (input: { params: { projectId: number } }) => {
    dockApi.dock = [...dockApi.dock, input.params.projectId];
    return { projectIds: dockApi.dock };
  },
  unpinProject: async (input: { params: { projectId: number } }) => {
    dockApi.dock = dockApi.dock.filter((it) => it !== input.params.projectId);
    return { projectIds: dockApi.dock };
  },
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      pinProject: dockApi.pinProject,
      unpinProject: dockApi.unpinProject,
    });
  }
}

class Routes {
  project = $page({
    name: "project",
    path: "/:projectSlug",
    component: () => null,
  });
  projectCreate = $page({
    name: "projectCreate",
    path: "/new-project",
    component: () => null,
  });
}

const row = (id: number, title: string, archivedAt?: string) => ({
  ...projectFixture({ id, title, slug: title.toLowerCase() }),
  areaCount: 0,
  openQuestCount: 0,
  owner: true,
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  archivedAt,
});

/**
 * My projects is where an archived project stays (#Q2601), so it lists it
 * and says which with an Archived badge.
 */
describe("MyProjects", () => {
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
    projects = [row(1, "Lore"), row(2, "Minorca", "2026-10-01T00:00:00.000Z")],
    dock: number[] = [],
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
    alepha.store.set(userProjectsAtom, {
      projects,
      totalCount: projects.length,
      ownedCount: projects.length,
      maxProjects: 50,
      canCreate: true,
    });
    alepha.store.set(userDockAtom, dock);
    dockApi.dock = dock;

    render(
      <AlephaContext.Provider value={alepha}>
        <MyProjects />
      </AlephaContext.Provider>,
    );
    return alepha;
  };

  it("hides archived projects on load (#Q3412)", async ({ expect }) => {
    window.localStorage.removeItem("lor.account.projects.filters");
    await mount();

    const rows = await screen.findAllByTestId("account-project-row");
    expect(rows.map((it) => it.textContent)).toEqual(["Lore"]);
    // The counter is gone; the filters are on the bar instead.
    expect(screen.queryByTestId("project-quota")).toBeNull();
    // The default reads "Archived: No" (#Q3562).
    expect(screen.queryByText("Not archived")).toBeNull();
    expect(screen.getAllByText("No").length).toBeGreaterThan(0);
  });

  it("opens with Archived as its only default filter, Role one click away (#Q3599)", async ({
    expect,
  }) => {
    window.localStorage.removeItem("lor.account.projects.filters");
    await mount();
    await screen.findAllByTestId("account-project-row");

    const onBar = [...document.querySelectorAll("[data-filter]")].map((it) =>
      it.getAttribute("data-filter"),
    );
    expect(onBar).toContain("archived");
    expect(onBar).not.toContain("role");
    // Still offered from the Role column's header.
    expect(
      screen.getByRole("columnheader", { name: /Your role/ }),
    ).toBeTruthy();
  });

  it("lists an archived project with an Archived badge once asked for", async ({
    expect,
  }) => {
    window.localStorage.setItem(
      "lor.account.projects.filters",
      JSON.stringify({ archived: "archived" }),
    );
    await mount();

    const rows = await screen.findAllByTestId("account-project-row");
    expect(rows.map((it) => it.textContent)).toEqual(["Minorca"]);
    const badges = screen.getAllByTestId("account-project-archived");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("Archived");
    expect(screen.getAllByText("Yes").length).toBeGreaterThan(0);
    window.localStorage.removeItem("lor.account.projects.filters");
  });

  describe("pins (#E139, #Q3440)", () => {
    const pinSwitch = (id: number) =>
      screen
        .getAllByTestId("account-project-pin")
        .find((it) => it.getAttribute("data-project-id") === String(id))!;

    it("pins and unpins from the switch, and the dock follows without a reload", async ({
      expect,
    }) => {
      window.localStorage.removeItem("lor.account.projects.filters");
      const app = await mount(
        [row(1, "Lore"), row(2, "Club"), row(3, "Acme")],
        [1],
      );
      await screen.findAllByTestId("account-project-row");
      // No counter on the toolbar (#Q3547): the switches say it.
      expect(screen.queryByText(/pinned/)).toBeNull();
      expect(pinSwitch(1).getAttribute("aria-checked")).toBe("true");
      expect(pinSwitch(2).getAttribute("aria-checked")).toBe("false");

      fireEvent.click(pinSwitch(2));
      await waitFor(() => expect(app.store.get(userDockAtom)).toEqual([1, 2]));
      expect(pinSwitch(2).getAttribute("aria-checked")).toBe("true");

      fireEvent.click(pinSwitch(1));
      await waitFor(() => expect(app.store.get(userDockAtom)).toEqual([2]));
    });

    it("holds off unpinned switches at twenty, and leaves pinned ones free", async ({
      expect,
    }) => {
      window.localStorage.removeItem("lor.account.projects.filters");
      const projects = Array.from({ length: 21 }, (_, i) =>
        row(i + 1, `Project ${i + 1}`),
      );
      await mount(
        projects,
        projects.slice(0, 20).map((it) => it.id),
      );
      await screen.findAllByTestId("account-project-row");

      expect(pinSwitch(21).hasAttribute("data-disabled")).toBe(true);
      // The refusal is explained at the switch, now the counter is gone:
      // a held-off switch sits in a tooltip trigger naming the cap.
      expect(pinSwitch(21).parentElement?.tagName).toBe("SPAN");
      expect(pinSwitch(1).parentElement?.tagName).not.toBe("SPAN");
      expect(pinSwitch(1).hasAttribute("data-disabled")).toBe(false);
    });

    it("draws no switch on an archived project", async ({ expect }) => {
      window.localStorage.setItem(
        "lor.account.projects.filters",
        JSON.stringify({ archived: "archived" }),
      );
      await mount();
      await screen.findAllByTestId("account-project-row");
      expect(screen.queryAllByTestId("account-project-pin")).toHaveLength(0);
      window.localStorage.removeItem("lor.account.projects.filters");
    });
  });
});
