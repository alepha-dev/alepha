import { render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { DataTableFilterFields } from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const rows: Row[] = [{ id: 1, title: "Alpha" }];

/**
 * A filter key set is read once, at mount.
 *
 * The form, persistence and `fromQuery` all anchor on the keys the table
 * mounted with, so a key that appears later is a filter nothing can hold, and
 * one that disappears keeps narrowing the list from the stored values. The
 * shape that produces it is natural: spreading a field out of the record while
 * its options load (`...(areas.length ? { area } : {})`). Development says so
 * rather than leaving a control that silently does nothing.
 */
describe("DataTable (filter keys changed after mount)", () => {
  let alepha: Alepha | undefined;
  const warn = console.warn;
  let warnings: string[] = [];

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    console.warn = warn;
    warnings = [];
    await alepha?.stop();
    alepha = undefined;
  });

  const table = (fields: DataTableFilterFields) => (
    <DataTable<Row, DataTableFilterFields>
      data={rows}
      columns={columns}
      filters={{ fields, render: () => null }}
    />
  );

  const mount = async (fields: DataTableFilterFields) => {
    // A missing browser API's worth of substitution, not a mock of the code
    // under test: the warning is the behaviour, and the console is where it
    // goes.
    console.warn = (...args: unknown[]) => void warnings.push(String(args[0]));
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const view = render(
      <AlephaContext.Provider value={alepha}>
        {table(fields)}
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return view;
  };

  it("warns once when a key appears after mount", async () => {
    const view = await mount({ search: { preset: "search" } });
    expect(warnings).toEqual([]);

    const grown = {
      search: { preset: "search" },
      area: { schema: z.array(z.string()) },
    } satisfies DataTableFilterFields;
    view.rerender(
      <AlephaContext.Provider value={alepha!}>
        {table(grown)}
      </AlephaContext.Provider>,
    );
    view.rerender(
      <AlephaContext.Provider value={alepha!}>
        {table(grown)}
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(warnings.length).toBe(1));
    expect(warnings[0]).toContain("search, area");
  });

  it("says nothing when only what a field shows changes", async () => {
    const view = await mount({
      area: { schema: z.array(z.string()), hidden: true },
    });

    view.rerender(
      <AlephaContext.Provider value={alepha!}>
        {table({
          area: {
            schema: z.array(z.string()),
            hidden: false,
            label: "Area",
            items: ["lore/quests"],
          },
        })}
      </AlephaContext.Provider>,
    );

    // A commit has passed: the effect that warns runs on every one.
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(warnings).toEqual([]);
  });
});
