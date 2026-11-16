import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { DataTableFilterFields } from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", sortable: true, cell: (r: Row) => r.title },
};

const fields = {
  search: { preset: "search" },
  scope: {
    schema: z.string(),
    label: "Scope",
    items: [
      { value: "a", label: "Scope A" },
      { value: "b", label: "Scope B" },
    ],
  },
} satisfies DataTableFilterFields;

/**
 * `filters.onChange` (#Q3779): the owner of a filter whose value drives a
 * read the table does not own hears every value, on mount and after each
 * change, while the table still draws, counts and persists the filter.
 */
describe("DataTable filters.onChange", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("reports the values on mount, seeded ones included, then on every change", async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const seen: Array<Record<string, unknown>> = [];

    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row, typeof fields>
          data={[
            { id: 1, title: "Alpha" },
            { id: 2, title: "Beta" },
          ]}
          columns={columns}
          filters={{
            fields,
            initialValues: { scope: "b" },
            onChange: (values) => seen.push(values),
          }}
          // The scope narrows nothing here: its owner reads it instead.
          filter={(row, values) =>
            !values.search ||
            row.title.toLowerCase().includes(values.search.toLowerCase())
          }
        />
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(seen[0]?.scope).toBe("b"));

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "alp" },
    });

    await waitFor(() =>
      expect(seen.at(-1)).toMatchObject({ scope: "b", search: "alp" }),
    );
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull());
    expect(screen.getByText("Alpha")).toBeTruthy();
  });
});
