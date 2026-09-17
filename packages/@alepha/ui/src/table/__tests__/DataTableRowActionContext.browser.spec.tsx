import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";

interface Row {
  id: number;
  title: string;
}

const rows: Row[] = [
  { id: 1, title: "Alpha" },
  { id: 2, title: "Beta" },
];

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * What a row action's `onClick` receives besides the row.
 *
 * `clearSelection` is there for a row deleted from its own menu (Lore
 * #Q2356): the row may be ticked, and a selection that outlives it points
 * at a row that no longer exists, so a following bulk action would act on it.
 */
describe("DataTable (row action context)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("lets a row action clear the checkbox selection", async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row>
          data={rows}
          columns={columns}
          bulkActions={[{ label: "Archive", onClick: () => {} }]}
          rowActions={() => [
            {
              label: "Delete",
              onClick: (_row, ctx) => ctx.clearSelection(),
            },
          ]}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    // The first checkbox is the header's select-all; the row ones follow.
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open row actions" })[0],
    );
    const entry = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Delete",
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(entry);

    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
  });
});
