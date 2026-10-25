import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { BulkAction } from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const rows: Row[] = [{ id: 1, title: "Alpha" }];

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * #Q2499: the pill's buttons took the default solid primary variant and
 * overrode only its background, so its darker border and top highlight
 * stayed and drew a blue ring on the dark pill. The classes that carry
 * them must not reach any button of the pill.
 */
describe("DataTable (bulk bar chrome)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (actions: BulkAction<Row>[]) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row> data={rows} columns={columns} bulkActions={actions} />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
  };

  /**
   * What the solid primary variant adds: the gradient, the top highlight
   * and the border darker than the primary fill.
   */
  const solidChrome = (button: HTMLElement) =>
    button.className
      .split(/\s+/)
      .filter(
        (name) =>
          name.startsWith("bg-linear-to-b") ||
          name.startsWith("shadow-[inset") ||
          name.startsWith("border-[color-mix(in_oklch,var(--primary)"),
      );

  it("draws no primary border or highlight on the actions and the close button", async () => {
    await mount([
      { label: "Export", onClick: () => undefined },
      { label: "Delete", destructive: true, onClick: () => undefined },
    ]);

    for (const name of ["Export", "Delete", "Clear selection"]) {
      expect(solidChrome(screen.getByRole("button", { name }))).toEqual([]);
    }
  });

  it("gives the close button no fill at rest", async () => {
    await mount([{ label: "Export", onClick: () => undefined }]);

    const close = screen.getByRole("button", { name: "Clear selection" });
    const fills = close.className
      .split(/\s+/)
      .filter((name) => name.startsWith("bg-") && name !== "bg-clip-padding");
    expect(fills).toEqual([]);
  });
});
