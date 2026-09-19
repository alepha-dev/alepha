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
  shelved: boolean;
}

const rows: Row[] = [
  { id: 1, title: "Alpha", shelved: false },
  { id: 2, title: "Beta", shelved: true },
];

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * A bulk action's `count`, drawn after its label, and the pill holding while
 * an async `onClick` runs (#Q2407).
 */
describe("DataTable (bulk action count and pending state)", () => {
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
  };

  // The first checkbox is the header's select-all; the row ones follow.
  const selectRow = (index: number) => {
    fireEvent.click(screen.getAllByRole("checkbox")[index + 1]);
  };

  it("draws how many of the selection the action touches", async () => {
    const unshelved = (selected: Row[]) =>
      selected.filter((row) => !row.shelved).length;
    await mount([
      {
        label: "Shelve",
        count: unshelved,
        visible: (selected) => unshelved(selected) > 0,
        onClick: () => undefined,
      },
      { label: "Export", onClick: () => undefined },
    ]);

    selectRow(0);
    selectRow(1);

    // Two selected, one of them unshelved.
    expect(screen.getByRole("button", { name: "Shelve 1" })).toBeTruthy();
    // No `count`, no number.
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
  });

  it("disables the pill until an async action settles", async () => {
    let settle: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    await mount([
      { label: "Shelve", onClick: () => pending },
      { label: "Export", onClick: () => undefined },
    ]);

    selectRow(0);
    fireEvent.click(screen.getByRole("button", { name: "Shelve" }));

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
    expect(
      (screen.getByRole("button", { name: "Shelve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    settle();

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });
});
