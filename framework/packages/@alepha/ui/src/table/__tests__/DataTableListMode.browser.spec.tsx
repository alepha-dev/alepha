import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { Bot, Pencil, Trash2 } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Row ${i + 1}`,
  }));

/**
 * A DataTable laid out as a plain list: every row on one page with no
 * footer (`pagination={false}`), shaded rows (`striped`), and the row's
 * actions as buttons rather than a menu (`rowActionsDisplay="inline"`).
 */
describe("DataTable (list mode)", () => {
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

  describe("pagination={false}", () => {
    it("shows every row past the default page size, and no footer", async () => {
      await mount(
        <DataTable<Row> data={rows(45)} columns={columns} pagination={false} />,
      );

      await waitFor(() => expect(screen.getByText("Row 45")).toBeTruthy());
      expect(screen.getByText("Row 1")).toBeTruthy();
      expect(screen.queryByText(/page 1 of/i)).toBeNull();
    });

    it("pages by default, which is what it turns off", async () => {
      await mount(<DataTable<Row> data={rows(45)} columns={columns} />);

      await waitFor(() => expect(screen.getByText("Row 1")).toBeTruthy());
      expect(screen.queryByText("Row 45")).toBeNull();
    });
  });

  describe("striped", () => {
    it("shades every other row only when asked", async () => {
      const { container, rerender } = await mount(
        <DataTable<Row> data={rows(3)} columns={columns} striped />,
      );
      await waitFor(() => expect(screen.getByText("Row 3")).toBeTruthy());
      const shaded = () =>
        container.querySelectorAll("tbody tr[class*='even:bg-muted']").length;
      expect(shaded()).toBe(3);

      rerender(
        <AlephaContext.Provider value={alepha!}>
          <DataTable<Row> data={rows(3)} columns={columns} />
        </AlephaContext.Provider>,
      );
      expect(shaded()).toBe(0);
    });
  });

  describe('rowActionsDisplay="inline"', () => {
    it("renders each action as a named button that runs it, with no menu", async () => {
      const clicked: string[] = [];
      await mount(
        <DataTable<Row>
          data={rows(1)}
          columns={columns}
          rowActionsDisplay="inline"
          rowActions={() => [
            {
              label: "Edit",
              icon: Pencil,
              onClick: (row) => clicked.push(`edit ${row.title}`),
            },
            {
              label: "Remove",
              icon: Trash2,
              destructive: true,
              onClick: (row) => clicked.push(`remove ${row.title}`),
            },
          ]}
        />,
      );

      const edit = await waitFor(() =>
        screen.getByRole("button", { name: "Edit" }),
      );
      fireEvent.click(edit);
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));

      expect(clicked).toEqual(["edit Row 1", "remove Row 1"]);
      expect(
        screen.queryByRole("button", { name: "Open row actions" }),
      ).toBeNull();
    });

    it("keeps a menu for a group, after the buttons", async () => {
      await mount(
        <DataTable<Row>
          data={rows(1)}
          columns={columns}
          rowActionsDisplay="inline"
          rowActions={() => [
            { label: "Edit", icon: Pencil, onClick: () => {} },
            {
              label: "Agents",
              icon: Bot,
              children: [{ label: "Run", onClick: () => {} }],
            },
          ]}
        />,
      );

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy(),
      );
      expect(
        screen.getByRole("button", { name: "Open row actions" }),
      ).toBeTruthy();
    });

    it("disables an action its row refuses", async () => {
      await mount(
        <DataTable<Row>
          data={rows(1)}
          columns={columns}
          rowActionsDisplay="inline"
          rowActions={() => [
            {
              label: "Edit",
              icon: Pencil,
              disabled: () => true,
              onClick: () => {},
            },
          ]}
        />,
      );

      const edit = await waitFor(() =>
        screen.getByRole("button", { name: "Edit" }),
      );
      expect((edit as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
