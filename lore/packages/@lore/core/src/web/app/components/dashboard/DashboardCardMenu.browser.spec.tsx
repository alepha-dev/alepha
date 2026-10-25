import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { I18n } from "../../services/I18n.ts";
import DashboardCardMenu from "./DashboardCardMenu.tsx";

const noop = () => {};

/**
 * The per-card kebab in edit mode.
 *
 * Its size entries sit under a label, and Base UI's label throws (error #31)
 * unless it lives inside a `Menu.Group`: the dashboard's edit mode crashed to
 * the error page on the first card render. Opening the menu is what renders
 * the label, so this opens it.
 */
describe("DashboardCardMenu", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  it("opens with its size entries without throwing", async ({ expect }) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    render(
      <AlephaContext.Provider value={alepha}>
        <DashboardCardMenu
          size={1}
          height={1}
          onResize={noop}
          onChangeScope={noop}
          onDuplicate={noop}
          onRemove={noop}
        />
      </AlephaContext.Provider>,
    );
    fireEvent.click(screen.getByLabelText("Card options"));

    expect(await screen.findAllByTestId("dashboard-card-size")).toHaveLength(6);
  });
});
