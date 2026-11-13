import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TooltipProvider } from "../../core/Tooltip.tsx";
import { DataTableFilterDialog } from "../DataTableFilterDialog.tsx";
import { DataTableFilterMenu } from "../DataTableFilterMenu.tsx";

/**
 * The toolbar's funnel buttons say what they are on hover, like the column
 * picker and refresh beside them (#Q3590): the filter menu's, and the filter
 * dialog's that replaces the bar on a narrow screen.
 */
describe("DataTable filter buttons' tooltips", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (node: ReactNode) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <TooltipProvider delay={0}>{node}</TooltipProvider>
      </AlephaContext.Provider>,
    );
  };

  const tooltip = () => document.querySelector('[data-slot="tooltip-content"]');

  const hover = (button: HTMLElement) => {
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    fireEvent.mouseEnter(button);
    fireEvent.pointerMove(button, { pointerType: "mouse" });
    fireEvent.mouseMove(button);
  };

  it("shows Filters on the filter menu's funnel", async () => {
    await mount(
      <DataTableFilterMenu
        activeCount={0}
        canReset={false}
        onReset={() => {}}
      />,
    );

    hover(screen.getByRole("button", { name: "Filters" }));

    await waitFor(() => expect(tooltip()?.textContent).toBe("Filters"));
  });

  it("shows Filters on the filter dialog's funnel", async () => {
    await mount(
      <DataTableFilterDialog
        form={{} as never}
        activeCount={2}
        canReset
        onReset={() => {}}
      >
        <div />
      </DataTableFilterDialog>,
    );

    hover(screen.getByRole("button", { name: "Filters" }));

    await waitFor(() => expect(tooltip()?.textContent).toBe("Filters"));
  });
});
