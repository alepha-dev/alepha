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
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userDockAtom } from "../../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { I18n } from "../../services/I18n.ts";
import ProjectInboxButton from "./ProjectInboxButton.tsx";
import ProjectRail from "./ProjectRail.tsx";

/**
 * One inbox behind both counts: the bell's total and the dock's per project.
 */
const inbox = {
  unread: 0,
  rows: [] as {
    id: string;
    title: string;
    href: string;
    createdAt: string;
    readAt?: string;
  }[],
  countInbox: async () => ({ unread: inbox.unread }),
  listInbox: async () => ({ items: inbox.rows, unreadCount: inbox.unread }),
  markInboxRead: async (input: { params: { id: string } }) => {
    inbox.rows = inbox.rows.map((it) =>
      it.id === input.params.id ? { ...it, readAt: "read" } : it,
    );
    inbox.unread = inbox.rows.filter((it) => !it.readAt).length;
    return { ok: true };
  },
  markAllInboxRead: async () => {
    inbox.rows = inbox.rows.map((it) => ({ ...it, readAt: "read" }));
    inbox.unread = 0;
    return { ok: true };
  },
  countInboxScopes: async (input: { body: { scopes: string[] } }) => ({
    counts: input.body.scopes.map((scope) => ({
      scope,
      unread: scope === "project:1" ? inbox.unread : 0,
    })),
  }),
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      countInbox: inbox.countInbox,
      listInbox: inbox.listInbox,
      markInboxRead: inbox.markInboxRead,
      markAllInboxRead: inbox.markAllInboxRead,
      countInboxScopes: inbox.countInboxScopes,
    });
  }
}

class Routes {
  home = $page({ name: "home", path: "/", component: () => null });
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

/**
 * The bell and the dock read two counts of one inbox (#Q4299): a read from
 * the bell has to clear the dock's badge too, not wait for the tab to lose
 * and regain focus.
 */
describe("ProjectInboxButton", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
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

    const project = {
      ...projectFixture({ id: 1, title: "Lore", slug: "lore" }),
      updatedAt: "2026-01-03T00:00:00.000Z",
      areaCount: 0,
      openQuestCount: 0,
      owner: true,
      lastActivityAt: "2026-01-01T00:00:00.000Z",
    };
    alepha.store.set(currentProjectAtom, project);
    alepha.store.set(userProjectsAtom, {
      projects: [project],
      totalCount: 1,
      ownedCount: 1,
      maxProjects: 50,
      canCreate: true,
    });
    alepha.store.set(userDockAtom, [1]);

    render(
      <AlephaContext.Provider value={alepha}>
        <ProjectRail />
        <ProjectInboxButton />
      </AlephaContext.Provider>,
    );
  };

  const seed = () => {
    inbox.rows = [
      {
        id: "m-1",
        title: "Ada mentioned you in #Q12",
        href: "/lore/quests/12",
        createdAt: "2026-11-25T07:00:00.000Z",
      },
      {
        id: "m-2",
        title: "Grace assigned you #Q13",
        href: "/lore/quests/13",
        createdAt: "2026-11-25T06:00:00.000Z",
      },
    ];
    inbox.unread = 2;
  };

  const openBell = async () => {
    fireEvent.click(screen.getByLabelText("Notifications"));
    await screen.findByText("Mark all read");
  };

  it("clears the docked project's badge after Mark all read in the bell", async ({
    expect,
  }) => {
    seed();
    await mount();
    await waitFor(() =>
      expect(screen.getByTestId("project-rail-badge").textContent).toBe("2"),
    );

    await openBell();
    fireEvent.click(screen.getByText("Mark all read"));

    await waitFor(() =>
      expect(screen.queryByTestId("project-rail-badge")).toBeNull(),
    );
    expect(screen.queryByTestId("inbox-badge")).toBeNull();
  });

  it("lowers the docked project's badge when a message is opened from the bell", async ({
    expect,
  }) => {
    seed();
    await mount();
    await waitFor(() =>
      expect(screen.getByTestId("project-rail-badge").textContent).toBe("2"),
    );

    await openBell();
    fireEvent.click(screen.getByText("Ada mentioned you in #Q12"));

    await waitFor(() =>
      expect(screen.getByTestId("project-rail-badge").textContent).toBe("1"),
    );
  });
});
