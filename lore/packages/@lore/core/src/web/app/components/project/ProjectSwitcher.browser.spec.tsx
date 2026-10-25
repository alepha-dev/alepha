import { SidebarProvider } from "@alepha/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { I18n } from "../../services/I18n.ts";
import ProjectSwitcher from "./ProjectSwitcher.tsx";

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

const row = (id: number, title: string, archivedAt?: string) => ({
  ...projectFixture({ id, title, slug: title.toLowerCase() }),
  areaCount: 0,
  openQuestCount: 0,
  owner: true,
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  archivedAt,
});

/**
 * The switcher leaves archived projects out (#Q2601), except the one being
 * looked at, which keeps its checkmark.
 */
describe("ProjectSwitcher", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const open = async (currentId: number) => {
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

    const projects = [
      row(1, "Lore"),
      row(2, "Minorca", "2026-10-01T00:00:00.000Z"),
      row(3, "Club"),
    ];
    alepha.store.set(
      currentProjectAtom,
      projects.find((it) => it.id === currentId) as never,
    );
    alepha.store.set(userProjectsAtom, {
      projects,
      totalCount: 3,
      ownedCount: 3,
      maxProjects: 10,
      canCreate: true,
    } as never);

    render(
      <AlephaContext.Provider value={alepha}>
        <SidebarProvider>
          <ProjectSwitcher />
        </SidebarProvider>
      </AlephaContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("project-switcher"));
    await screen.findByText("Club");
  };

  it("leaves an archived project out of the menu", async ({ expect }) => {
    await open(1);

    expect(screen.getAllByText("Lore").length).toBeGreaterThan(0);
    expect(screen.queryByText("Minorca")).toBeNull();
    // Archived projects are still one click away, in My projects.
    expect(screen.getByTestId("switcher-all-projects")).toBeTruthy();
  });

  it("keeps the archived project you are looking at", async ({ expect }) => {
    await open(2);

    // Once on the trigger, once in the menu.
    expect(screen.getAllByText("Minorca")).toHaveLength(2);
  });
});
