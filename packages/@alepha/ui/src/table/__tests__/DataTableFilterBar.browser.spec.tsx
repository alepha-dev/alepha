import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
} from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const filterFields = {
  search: { preset: "search" },
  status: {
    schema: z.enum(["open", "closed"]),
    label: "Status",
    operators: "is",
    items: [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ],
  },
  owner: { schema: z.string(), label: "Owner" },
} satisfies DataTableFilterFields;

type Filters = DataTableFilterValues<typeof filterFields>;

/**
 * The table's filter bar: the three behaviours that are state rather than
 * markup, and so the three a refactor can break without a type error.
 *
 * - A filter holding a value is on the bar however it got that value. Which
 *   filters are shown starts from the declaration on every mount, while the
 *   values come back from persistence, a link or a seed; keyed on the shown
 *   state alone, the table stayed filtered behind an empty bar.
 * - The button is staged: it clears a set filter, and removes an empty one.
 * - An operator goes back to its default when its value empties by any
 *   route, not only the button - or it keeps counting as a filter while
 *   narrowing nothing.
 */
describe("DataTableFilterBar", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
  });

  /**
   * Mounts a table whose bar has the search box, a Status list (with is / is
   * not) and an Owner text filter, both optional, seeded with `seed`. Returns
   * the last filters the table fetched with, so a spec can read what the form
   * holds after an interaction.
   */
  const mount = async (seed?: Filters) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const seen: Array<Filters | undefined> = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row, typeof filterFields>
          columns={columns}
          filters={{ fields: filterFields, seedValues: seed }}
          fetch={async ({ filters }) => {
            seen.push({ ...filters });
            return {
              content: [{ id: 1, title: "Alpha" }],
              page: {
                number: 0,
                size: 20,
                offset: 0,
                numberOfElements: 1,
                totalElements: 1,
                totalPages: 1,
                isEmpty: false,
                isFirst: true,
                isLast: true,
              },
            };
          }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return { last: () => seen.at(-1) };
  };

  const slot = (key: string) =>
    document.querySelector(`[data-filter="${key}"]`);

  it("starts with the search box alone", async () => {
    await mount();

    expect(screen.getByPlaceholderText("Search")).toBeTruthy();
    expect(slot("status")).toBeNull();
    expect(slot("owner")).toBeNull();
  });

  it("shows a filter that already holds a value, and names it on the trigger", async () => {
    await mount({ status: "closed", statusOp: "not" });

    await waitFor(() => expect(slot("status")).toBeTruthy());
    const trigger = slot("status")!.querySelector(
      '[data-slot="combobox-trigger"]',
    );
    // One text run, one space between each word: "Status: not Closed".
    expect(trigger?.textContent).toBe("Status: not Closed");
    expect(slot("owner")).toBeNull();
  });

  it("takes back the room the trigger keeps for the clear cross it hides", async () => {
    await mount({ status: "closed" });

    await waitFor(() => expect(slot("status")).toBeTruthy());
    // jsdom loads no Tailwind, so the rule is read off the classes: the label
    // run still carries its `mr-*` for the in-field cross, and the box, which
    // hides that cross, carries the rule that zeroes it.
    const label = slot("status")!.querySelector(
      '[data-slot="combobox-trigger"] [data-slot="trigger-label"]',
    ) as HTMLElement | null;
    expect(label?.className).toMatch(/\bmr-\d/);
    const box = slot("status")!.firstElementChild as HTMLElement;
    expect(box.className).toContain('[&_[data-slot="trigger-label"]]:mr-0');
  });

  it("shows a filter holding only an operator, and keeps the operator", async () => {
    const { last } = await mount({ statusOp: "not" });

    await waitFor(() => expect(slot("status")).toBeTruthy());
    // Restored on mount is not "emptied": nothing held a value before.
    expect(last()?.statusOp).toBe("not");
  });

  it("clears a set filter first, and removes it on the second press", async () => {
    const { last } = await mount({ status: "open" });
    await waitFor(() => expect(slot("status")).toBeTruthy());

    fireEvent.click(
      screen.getByRole("button", { name: "Clear value: Status" }),
    );

    await waitFor(() => expect(last()?.status).toBeUndefined());
    // Still on the bar, now offering the second act.
    expect(slot("status")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter: Status" }),
    );

    await waitFor(() => expect(slot("status")).toBeNull());
  });

  it("resets the operator when the value empties without the button", async () => {
    const { last } = await mount({ status: "open", statusOp: "not" });
    await waitFor(() => expect(slot("status")).toBeTruthy());

    // A route that empties the value and tells nothing else: the select's own
    // cross, which the bar's box hides in a browser but which is still in the
    // markup, and still what a keyboard or an unticked option amounts to.
    const ownClear = slot("status")!.querySelector<HTMLElement>(
      '[data-slot="combobox-clear"], [data-slot="control-clear"]',
    );
    expect(ownClear).toBeTruthy();
    fireEvent.click(ownClear!);

    await waitFor(() => expect(last()?.statusOp).toBeUndefined());
    expect(last()?.status).toBeUndefined();
    // Emptied, not removed: the reader is still looking at it.
    expect(slot("status")).toBeTruthy();
  });
});
