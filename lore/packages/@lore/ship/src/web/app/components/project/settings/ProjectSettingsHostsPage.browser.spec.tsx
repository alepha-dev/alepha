import { DialogProvider } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import ProjectSettingsHostsPage from "./ProjectSettingsHostsPage.tsx";

const HOME_ID = "00000000-0000-4000-8000-0000000000a1";
const BORROWED_ID = "00000000-0000-4000-8000-0000000000b1";
const UNLENT_ID = "00000000-0000-4000-8000-0000000000c1";

const lent = (id: string, slug: string, isHome: boolean) => ({
  id,
  slug,
  type: "bay",
  online: true,
  overdue: false,
  deployAllowed: true,
  acceptedRuntimes: ["node"],
  home: isHome ? { id: 7, title: "Acme" } : { id: 8, title: "Infra" },
  isHome,
  can: isHome ? ["host:read"] : [],
  lentAt: "2026-09-01T10:00:00.000Z",
});

const homed = (id: string, slug: string) => ({
  id,
  slug,
  type: "bay",
  online: false,
  overdue: false,
  deployAllowed: false,
  collectSeries: false,
  statsIntervalSeconds: 1800,
  acceptedRuntimes: ["node"],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  project: { id: 7, title: "Acme" },
  can: ["host:read"],
  projects: [],
});

class HostLinks extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, action: string) =>
          Object.assign(
            async () => {
              if (action === "listProjectHosts") {
                return {
                  items: [
                    lent(HOME_ID, "ovh-home", true),
                    lent(BORROWED_ID, "ovh-infra", false),
                  ],
                };
              }
              if (action === "listHomeHosts") {
                return {
                  items: [
                    homed(HOME_ID, "ovh-home"),
                    homed(UNLENT_ID, "spare"),
                  ],
                };
              }
              return {};
            },
            { can: () => true },
          ),
      },
    );
  }
}

class Routes {
  bay = $page({
    name: "bay",
    path: "/:projectSlug/hosts/:hostSlug",
    component: () => null,
  });
}

/**
 * The project's Hosts tab (#Q3281), one table since #Q3409: the hosts
 * this project is the home of and the ones it borrows share it, told apart by
 * the Origin column, and a home host never reads as lent.
 */
describe("ProjectSettingsHostsPage", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("separates the hosts the project is the home of from those it borrows", async ({
    expect,
  }) => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: HostLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ id: 7, title: "Acme", slug: "acme" }),
    );
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectSettingsHostsPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("home-host-row")).toHaveLength(2),
    );
    // One table, three rows: two home hosts, one borrowed.
    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(3);
    const text = (slug: string) =>
      rows.find((row) => row.textContent?.includes(slug))?.textContent ?? "";

    // A home host is "This project", lent to its home or not.
    expect(text("ovh-home")).toContain("This project");
    expect(text("ovh-home")).not.toContain("Lent");
    // Only the one its home does not lend to itself says so, since the
    // project cannot deploy onto it.
    expect(text("spare")).toContain("Not lent to this project");
    expect(text("ovh-home")).not.toContain("Not lent to this project");
    // The borrowed one is flagged Lent and names its home project.
    expect(screen.getAllByTestId("host-row")).toHaveLength(1);
    expect(text("ovh-infra")).toContain("Lent");
    expect(text("ovh-infra")).toContain("lent by Infra");

    // Add a host is the table's toolbar action, and Origin a filter.
    expect(screen.getByRole("button", { name: "Add a host" })).toBeTruthy();
    expect(screen.getAllByText("Origin").length).toBeGreaterThan(0);
  });
});
