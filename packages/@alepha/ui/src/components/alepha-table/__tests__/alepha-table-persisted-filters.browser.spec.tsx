import { render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const rows: Row[] = [{ id: 1, title: "Alpha" }];

/**
 * Persisted filters meet a schema that has since changed shape.
 *
 * They live in `localStorage` under the table's `persistenceKey`, so a
 * filter that changes shape meets values written by the previous one - on
 * the machine of anyone who has used the page, and ONLY there. That is
 * precisely the class of bug no test environment contains unless it seeds
 * the storage itself, which is what these cases do.
 *
 * `reconcilePersistedFilters` was written for the Quests table going from
 * one value per filter to many, and had no coverage until four more filters
 * made the same move (feedback #2092: Releases, Blights, MyFeedback and
 * Activity).
 */
describe("AlephaTable (persisted filters that changed shape)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  const arrayFilters = z.object({
    state: z.array(z.enum(["open", "released"])).optional(),
  });

  it("wraps a stored scalar for a filter that is now an array", async () => {
    // What an older session wrote, when `state` was a single value.
    window.localStorage.setItem(
      "probe.filters",
      JSON.stringify({ state: "open" }),
    );

    const seen: Array<Record<string, any> | undefined> = [];
    await mount(
      <AlephaTable<Row>
        persistenceKey="probe"
        columns={columns}
        filters={{ schema: arrayFilters, render: () => null }}
        fetch={async ({ filters }) => {
          seen.push(filters);
          return {
            content: rows,
            page: {
              number: 0,
              size: 20,
              offset: 0,
              numberOfElements: rows.length,
              totalElements: rows.length,
              totalPages: 1,
              isEmpty: false,
              isFirst: true,
              isLast: true,
            },
          };
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    // Wrapped, not dropped: the reader's filter survives the migration,
    // which is what makes it invisible to them.
    expect(seen[0]?.state).toEqual(["open"]);
  });

  it("takes the first element when an array meets a filter that is now scalar", async () => {
    window.localStorage.setItem(
      "probe.filters",
      JSON.stringify({ state: ["released", "open"] }),
    );

    const seen: Array<Record<string, any> | undefined> = [];
    await mount(
      <AlephaTable<Row>
        persistenceKey="probe"
        columns={columns}
        filters={{
          schema: z.object({
            state: z.enum(["open", "released"]).optional(),
          }),
          render: () => null,
        }}
        fetch={async ({ filters }) => {
          seen.push(filters);
          return {
            content: rows,
            page: {
              number: 0,
              size: 20,
              offset: 0,
              numberOfElements: rows.length,
              totalElements: rows.length,
              totalPages: 1,
              isEmpty: false,
              isFirst: true,
              isLast: true,
            },
          };
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    // There is no honest way to keep the rest.
    expect(seen[0]?.state).toBe("released");
  });

  it("drops a stored filter the schema no longer has", async () => {
    // `blights.status` carried an `"all"` value that left the enum with
    // feedback #2092. A removed FIELD must not reappear in the fetch
    // payload either, or the server is asked to filter on something the
    // page no longer offers.
    window.localStorage.setItem(
      "probe.filters",
      JSON.stringify({ state: "open", retired: "all" }),
    );

    const seen: Array<Record<string, any> | undefined> = [];
    await mount(
      <AlephaTable<Row>
        persistenceKey="probe"
        columns={columns}
        filters={{ schema: arrayFilters, render: () => null }}
        fetch={async ({ filters }) => {
          seen.push(filters);
          return {
            content: rows,
            page: {
              number: 0,
              size: 20,
              offset: 0,
              numberOfElements: rows.length,
              totalElements: rows.length,
              totalPages: 1,
              isEmpty: false,
              isFirst: true,
              isLast: true,
            },
          };
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(seen[0]).not.toHaveProperty("retired");
    expect(seen[0]?.state).toEqual(["open"]);
  });
});
