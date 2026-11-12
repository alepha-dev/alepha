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

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `Row ${i + 1}` }));

/**
 * The three props that make a DataTable light enough for a dialog:
 * `hideToolbar`, `pagination="compact"` and `density="compact"`.
 */
describe("DataTable lightweight props", () => {
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

  describe("hideToolbar", () => {
    it("draws no toolbar band, not even the column picker", async () => {
      await mount(
        <DataTable<Row> data={rows(3)} columns={columns} hideToolbar />,
      );
      await waitFor(() => expect(screen.getByText("Row 1")).toBeTruthy());
      expect(screen.queryByLabelText("Toggle columns")).toBeNull();
      expect(screen.queryByLabelText("Refresh")).toBeNull();
    });

    it("keeps the toolbar when unset", async () => {
      await mount(<DataTable<Row> data={rows(3)} columns={columns} />);
      await waitFor(() => expect(screen.getByText("Row 1")).toBeTruthy());
      expect(screen.getByLabelText("Toggle columns")).toBeTruthy();
    });
  });

  describe("pagination=compact", () => {
    it("pages static rows with two chevrons and no size picker", async () => {
      await mount(
        <DataTable<Row>
          data={rows(25)}
          columns={columns}
          defaultSize={10}
          pagination="compact"
        />,
      );
      await waitFor(() => expect(screen.getByText("Row 1")).toBeTruthy());
      expect(screen.getByText("Page 1 of 3")).toBeTruthy();
      expect(screen.queryByLabelText("Rows per page")).toBeNull();
      expect(screen.queryByText("2")).toBeNull();

      const previous = screen.getByLabelText("Go to previous page");
      expect((previous as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByLabelText("Go to next page"));
      await waitFor(() => expect(screen.getByText("Row 11")).toBeTruthy());
      expect(screen.getByText("Page 2 of 3")).toBeTruthy();
      expect(screen.queryByText("Row 1")).toBeNull();
    });

    it("draws nothing while the rows fit on one page", async () => {
      await mount(
        <DataTable<Row>
          data={rows(4)}
          columns={columns}
          pagination="compact"
        />,
      );
      await waitFor(() => expect(screen.getByText("Row 4")).toBeTruthy());
      expect(screen.queryByText(/Page 1/)).toBeNull();
      expect(screen.queryByLabelText("Go to next page")).toBeNull();
    });

    it("pages a fetch table on the server", async () => {
      const all = rows(12);
      const requested: number[] = [];
      await mount(
        <DataTable<Row>
          columns={columns}
          defaultSize={5}
          pagination="compact"
          fetch={async ({ page, size }) => {
            requested.push(page);
            const content = all.slice(page * size, page * size + size);
            return {
              content,
              page: {
                number: page,
                size,
                offset: page * size,
                numberOfElements: content.length,
                totalElements: all.length,
                totalPages: Math.ceil(all.length / size),
                isEmpty: content.length === 0,
                isFirst: page === 0,
                isLast: (page + 1) * size >= all.length,
              },
            };
          }}
        />,
      );
      await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeTruthy());
      fireEvent.click(screen.getByLabelText("Go to next page"));
      await waitFor(() => expect(screen.getByText("Row 6")).toBeTruthy());
      expect(requested).toContain(1);
      expect(screen.queryByLabelText("Rows per page")).toBeNull();
    });
  });

  describe("density=compact", () => {
    it("tightens the cells and the type", async () => {
      await mount(
        <DataTable<Row> data={rows(2)} columns={columns} density="compact" />,
      );
      await waitFor(() => expect(screen.getByText("Row 1")).toBeTruthy());
      const cell = screen.getByText("Row 1").closest("td")!;
      expect(cell.className).toContain("py-1");
      expect(cell.closest("table")!.className).toContain("text-xs");
    });

    it("lets an explicit cellPadding win the padding", async () => {
      await mount(
        <DataTable<Row>
          data={rows(2)}
          columns={columns}
          density="compact"
          cellPadding="large"
        />,
      );
      await waitFor(() => expect(screen.getByText("Row 1")).toBeTruthy());
      expect(screen.getByText("Row 1").closest("td")!.className).toContain(
        "p-3",
      );
    });
  });
});
