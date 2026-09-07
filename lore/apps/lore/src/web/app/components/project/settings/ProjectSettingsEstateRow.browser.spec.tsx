import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, expect, it } from "vitest";

import type { LentEstateResource } from "@/api/controllers/ProjectEstateController.ts";

import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsEstateRow from "./ProjectSettingsEstateRow.tsx";

/**
 * Whether the estate's name is a door (feedback #P2126).
 *
 * ⚠️ The two cases are the whole point. The Bay console is owner-only and
 * `EstateService.loadOwned` answers **404** to anybody else, so a link on a
 * borrower's row would be worse than the inert text it replaced: it would
 * promise a page that does not exist for them.
 */
class Routes {
  bay = $page({
    name: "bay",
    path: "/bay/:estateId",
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
    owner: { id: "00000000-0000-4000-8000-000000000001", name: "Feunard" },
    ownedByViewer: true,
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

  it("opens the console from the name, for the estate's owner", async () => {
    await mount(anEstate());

    const link = screen.getByRole("link", { name: "ovh-1" });
    expect(link.getAttribute("href")).toBe(`/bay/${ESTATE_ID}`);
  });

  it("leaves the name as plain text for a borrower", async () => {
    // The console 404s for them, so a link would dead-end.
    const { container } = await mount(anEstate({ ownedByViewer: false }));

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
    await mount(anEstate({ ownedByViewer: false }), false);

    expect(screen.queryByRole("button", { name: "Detach" })).toBeNull();
  });
});
