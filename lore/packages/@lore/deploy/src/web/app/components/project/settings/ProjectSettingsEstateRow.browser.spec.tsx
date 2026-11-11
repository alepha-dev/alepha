import { I18n } from "@lore/core/web";
import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, expect, it } from "vitest";

import type { LentEstateResource } from "../../../../../api/controllers/ProjectEstateController.ts";
import ProjectSettingsEstateRow from "./ProjectSettingsEstateRow.tsx";

/**
 * Whether the estate's name is a door (feedback #P2126).
 *
 * ⚠️ The two cases are the whole point. The Bay console lives under the
 * estate's HOME project (#E126), which answers **403** to anybody who is not
 * a member there, so a link on a borrower's row would be worse than the
 * inert text it replaced: it would promise a page they cannot open.
 */
class Routes {
  bay = $page({
    name: "bay",
    path: "/:projectSlug/estates/:estateSlug",
    component: () => null,
  });
}

const ESTATE_ID = "00000000-0000-4000-8000-0000000000e1";

const anEstate = (over: Partial<LentEstateResource> = {}) =>
  ({
    id: ESTATE_ID,
    slug: "ovh-1",
    type: "bay",
    online: true,
    deployAllowed: true,
    acceptedRuntimes: ["node"],
    home: { id: 7, title: "Acme", slug: "acme" },
    isHome: false,
    can: ["estate:read"],
    lentAt: "2026-09-01T10:00:00.000Z",
    ...over,
  }) as LentEstateResource;

describe("ProjectSettingsEstateRow", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (estate: LentEstateResource, canDetach = true) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    return render(
      <AlephaContext.Provider value={alepha}>
        <ProjectSettingsEstateRow
          estate={estate}
          canDetach={canDetach}
          onDetach={() => {}}
        />
      </AlephaContext.Provider>,
    );
  };

  it("opens the console from the name, for a member of its home project", async () => {
    await mount(anEstate());

    const link = screen.getByRole("link", { name: "ovh-1" });
    // Under the home project, never under the project listing the loan.
    expect(link.getAttribute("href")).toBe("/acme/estates/ovh-1");
  });

  it("leaves the name as plain text for a borrower", async () => {
    // The console answers 403 for them, so a link would dead-end.
    const { container } = await mount(anEstate({ can: [] }));

    expect(screen.queryByRole("link", { name: "ovh-1" })).toBeNull();
    expect(container.textContent).toContain("ovh-1");
  });

  it("keeps Detach a separate control, never the row's own click target", async () => {
    // A row-wide link would swallow it, and detaching has its own
    // confirmation because it is a different act.
    await mount(anEstate());

    const detach = screen.getByRole("button", { name: "Detach" });
    expect(detach.closest("a")).toBeNull();
    // And the name link does not wrap the row either.
    const link = screen.getByRole("link", { name: "ovh-1" });
    expect(link.textContent).toBe("ovh-1");
  });

  it("draws no Detach for a reader who may not withdraw the loan", async () => {
    await mount(anEstate({ can: [] }), false);

    expect(screen.queryByRole("button", { name: "Detach" })).toBeNull();
  });
});
