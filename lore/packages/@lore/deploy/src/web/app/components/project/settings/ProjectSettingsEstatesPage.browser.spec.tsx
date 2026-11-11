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

import ProjectSettingsEstatesPage from "./ProjectSettingsEstatesPage.tsx";

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
  can: isHome ? ["estate:read"] : [],
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
  can: ["estate:read"],
  projects: [],
});

class EstateLinks extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, action: string) =>
          Object.assign(
            async () => {
              if (action === "listProjectEstates") {
                return {
                  items: [
                    lent(HOME_ID, "ovh-home", true),
                    lent(BORROWED_ID, "ovh-infra", false),
                  ],
                };
              }
              if (action === "listHomeEstates") {
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
    path: "/:projectSlug/estates/:estateSlug",
    component: () => null,
  });
}

/**
 * The project's Estates tab (#Q3281) in two groups: the estates this project
 * is the home of, lent here or not, and the ones it only borrows, each
 * naming its home project.
 */
describe("ProjectSettingsEstatesPage", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("separates the estates the project is the home of from those it borrows", async ({
    expect,
  }) => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: EstateLinks })
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
          <ProjectSettingsEstatesPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("home-estate-row")).toHaveLength(2),
    );
    const homeRows = screen.getAllByTestId("home-estate-row");
    expect(homeRows[0]!.textContent).toContain("Lent to this project");
    expect(homeRows[1]!.textContent).toContain("Not lent to this project");
    // The borrowed group holds only the other project's estate.
    const borrowed = screen.getAllByTestId("estate-row");
    expect(borrowed).toHaveLength(1);
    expect(borrowed[0]!.textContent).toContain("ovh-infra");
    expect(borrowed[0]!.textContent).toContain("Infra");
  });
});
