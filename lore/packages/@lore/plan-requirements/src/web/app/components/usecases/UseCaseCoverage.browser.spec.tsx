import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  ElementReferenceRegistry,
  I18n,
} from "@lore/core/web";
import { render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import UseCaseCoverage from "./UseCaseCoverage.tsx";

const QUESTS = [
  { shortId: 11, title: "Cart page", epicNumber: 2, completedAt: "x" },
  { shortId: 12, title: "Promo engine", epicNumber: 2, acceptedAt: "x" },
  { shortId: 21, title: "Receipt mail", epicNumber: 3, completedAt: "x" },
];

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({ getUseCaseCoverage: async () => QUESTS });
  }
}

/**
 * The Coverage tab of a use case (#E153), grouped by epic (#Q3980).
 */
describe("UseCaseCoverage", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("groups the covering quests under each epic, titled with done / total, without a per-row epic suffix", async ({
    expect,
  }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n)
      .with(ElementReferenceRegistry);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture({ capabilities: ["plan"] }),
      slug: "acme",
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <UseCaseCoverage
          projectId={1}
          useCase={
            {
              number: 1,
              coveredBy: [
                { id: 2, number: 2, title: "Checkout" },
                { id: 3, number: 3, title: "Receipts" },
              ],
            } as unknown as UseCaseResource
          }
        />
      </AlephaContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("coverage-epic")).toHaveLength(2),
    );
    const [checkout, receipts] = screen.getAllByTestId("coverage-epic");
    expect(checkout.querySelector("h3")?.textContent).toContain("Checkout");
    expect(checkout.querySelector("h3")?.textContent).toContain("1 / 2 done");
    expect(checkout.querySelectorAll("li")).toHaveLength(2);
    expect(receipts.querySelector("h3")?.textContent).toContain("1 / 1 done");
    expect(receipts.textContent).toContain("Receipt mail");
    expect(receipts.textContent).not.toContain("Cart page");
    // The epic is named once, on its heading, not on every row.
    expect(checkout.querySelector("li")?.textContent).not.toContain("#E2");
  });
});
