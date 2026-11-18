import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";

interface Row {
  id: number;
  title: string;
  state: string;
}

const ROWS: Row[] = [
  { id: 1, title: "Alpha", state: "passed" },
  { id: 2, title: "Beta", state: "failed" },
  { id: 3, title: "Gamma", state: "passed" },
  { id: 4, title: "Delta", state: "never_run" },
];

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const filterFields = {
  state: {
    schema: z.array(z.string()),
    label: "State",
    items: [
      { label: "Passed", value: "passed" },
      { label: "Failed", value: "failed" },
      { label: "Never run", value: "never_run" },
    ],
  },
};

const titles = () =>
  [...document.querySelectorAll("tbody tr[data-row-key]")].map(
    (row) => row.textContent,
  );

/**
 * Grouped rows (`groupBy`), the open row (`isRowActive`) and summary tiles
 * that filter (`filter` on a stat card): the two pieces a list of a few hundred rows needs to read on
 * one page, its groups folding and its counters acting as quick filters.
 */
describe("DataTable groups and filtering tiles", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  describe("groupBy", () => {
    it("draws a header per group, in row order, with its count", async () => {
      await mount(
        <DataTable<Row>
          data={ROWS}
          pagination={false}
          columns={columns}
          groupBy={{ key: (row) => row.state }}
        />,
      );

      await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
      const groups = [
        ...document.querySelectorAll('[data-slot="data-table-group"]'),
      ].map((row) => row.getAttribute("data-group"));
      expect(groups).toEqual(["passed", "failed", "never_run"]);
      // Each group's rows sit under it, in their order.
      expect(titles()).toEqual(["Alpha", "Gamma", "Beta", "Delta"]);
      expect(document.querySelector('[data-group="passed"]')?.textContent).toBe(
        "passed2",
      );
    });

    it("folds and unfolds a group from its header", async () => {
      await mount(
        <DataTable<Row>
          data={ROWS}
          pagination={false}
          columns={columns}
          groupBy={{
            key: (row) => row.state,
            label: (key) => `State ${key}`,
          }}
        />,
      );
      await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

      const toggle = screen.getByRole("button", { name: /State passed/ });
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(titles()).toEqual(["Beta", "Delta"]);

      fireEvent.click(toggle);
      expect(titles()).toEqual(["Alpha", "Gamma", "Beta", "Delta"]);
    });

    it("orders the groups and starts them folded on request", async () => {
      await mount(
        <DataTable<Row>
          data={ROWS}
          pagination={false}
          columns={columns}
          groupBy={{
            key: (row) => row.state,
            order: (a, b) => a.localeCompare(b),
            defaultCollapsed: true,
          }}
        />,
      );
      await waitFor(() =>
        expect(
          document.querySelectorAll('[data-slot="data-table-group"]').length,
        ).toBe(3),
      );

      expect(
        [...document.querySelectorAll('[data-slot="data-table-group"]')].map(
          (row) => row.getAttribute("data-group"),
        ),
      ).toEqual(["failed", "never_run", "passed"]);
      expect(titles()).toEqual([]);
    });
  });

  describe("isRowActive", () => {
    it("marks the row the page has open, and only that one", async () => {
      await mount(
        <DataTable<Row>
          data={ROWS}
          pagination={false}
          columns={columns}
          rowKey={(row) => String(row.id)}
          isRowActive={(row) => row.id === 2}
        />,
      );
      await waitFor(() => expect(screen.getByText("Beta")).toBeTruthy());

      const active = [...document.querySelectorAll("tbody tr[aria-current]")];
      expect(active.map((row) => row.getAttribute("data-row-key"))).toEqual([
        "2",
      ]);
      expect(active[0].getAttribute("aria-current")).toBe("true");
    });
  });

  describe("a summary tile with a filter", () => {
    it("filters the rows on a click, shows it pressed, and clears on a second", async () => {
      await mount(
        <DataTable<Row, typeof filterFields>
          data={ROWS}
          pagination={false}
          columns={columns}
          filters={{ fields: filterFields }}
          summary={{
            cards: [
              { label: "All", value: "4" },
              { label: "Failed", value: "1", filter: { state: ["failed"] } },
            ],
          }}
        />,
      );
      await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

      // A tile without a filter stays a figure, not a button.
      expect(screen.queryByRole("button", { name: "All" })).toBeNull();

      const failed = screen.getByRole("button", { name: "Failed" });
      expect(failed.getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(failed);
      await waitFor(() => expect(titles()).toEqual(["Beta"]));
      expect(failed.getAttribute("aria-pressed")).toBe("true");

      fireEvent.click(failed);
      await waitFor(() =>
        expect(titles()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]),
      );
      expect(failed.getAttribute("aria-pressed")).toBe("false");
    });
  });
});
