import { DialogProvider } from "@alepha/ui";
import { I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { OwnedEstateResource } from "../../../../api/schemas/ownedEstateResourceSchema.ts";
import { currentEstateAtom } from "../../atoms/currentEstateAtom.ts";
import BaySettings from "./BaySettings.tsx";

class QuietLinks extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: () =>
          Object.assign(async () => ({ items: [] }), { can: () => true }),
      },
    );
  }
}

class Routes {
  baySettings = $page({
    name: "baySettings",
    path: "/:projectSlug/estates/:estateSlug/settings",
    component: () => null,
  });
  projectSettingsEstates = $page({
    name: "projectSettingsEstates",
    path: "/:projectSlug/settings/estates",
    component: () => null,
  });
}

const estate = (can: string[]): OwnedEstateResource =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    slug: "ovh-1",
    type: "bay",
    online: true,
    overdue: false,
    deployAllowed: false,
    collectSeries: false,
    statsIntervalSeconds: 1800,
    acceptedRuntimes: ["node"],
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    project: { id: 7, title: "Acme", slug: "acme" },
    creator: { id: "00000000-0000-4000-8000-0000000000c1", name: "Builder" },
    can,
    projects: [],
  }) as OwnedEstateResource;

/**
 * The console's Settings tab by rank (#Q3281): a plain Member of the home
 * project, who holds `estate:read` only, reads a designed read-only page
 * saying which permission would let them act, and is offered no control.
 */
describe("BaySettings", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (can: string[]) => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: QuietLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentEstateAtom, estate(can));
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <BaySettings />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("gives a reader a read-only page, with nothing to press", async ({
    expect,
  }) => {
    await show(["estate:read"]);

    expect(screen.getByTestId("bay-settings-readonly").textContent).toContain(
      "estate:update in Acme",
    );
    expect(screen.getByTestId("bay-settings-home").textContent).toContain(
      "Acme",
    );
    expect(screen.getByTestId("bay-settings-creator").textContent).toContain(
      "Builder",
    );
    expect(screen.queryByTestId("bay-settings-deploys")).toBeNull();
    expect(screen.queryByTestId("bay-settings-rotate")).toBeNull();
    expect(screen.queryByTestId("bay-settings-delete")).toBeNull();
    expect(screen.queryByTestId("bay-settings-move")).toBeNull();
  });

  it("offers the switches and rotate under estate:update, delete and move under estate:delete", async ({
    expect,
  }) => {
    await show(["estate:read", "estate:update"]);
    expect(screen.queryByTestId("bay-settings-readonly")).toBeNull();
    expect(screen.getByTestId("bay-settings-deploys")).toBeTruthy();
    expect(screen.getByTestId("bay-settings-rotate")).toBeTruthy();
    expect(screen.queryByTestId("bay-settings-delete")).toBeNull();
    expect(screen.queryByTestId("bay-settings-move")).toBeNull();

    await show(["estate:read", "estate:update", "estate:delete"]);
    expect(screen.getByTestId("bay-settings-delete")).toBeTruthy();
    expect(screen.getByTestId("bay-settings-move")).toBeTruthy();
  });
});
