import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha, z } from "alepha";
import type { ZObject } from "alepha";
import { AlephaContext } from "alepha/react";
import type { FormModel } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTableFilterBar } from "../alepha-table-filter-bar.tsx";
import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const rows: Row[] = [{ id: 1, title: "Alpha" }];

const schema = z.object({
  search: z.string().optional(),
  status: z.enum(["open", "closed"]).optional(),
  statusOp: z.enum(["is", "not"]).optional(),
  owner: z.string().optional(),
});

/**
 * `AlephaTableFilterBar`, through `AlephaTable`: the three behaviours that
 * are state rather than markup, and so the three a refactor can break without
 * a type error.
 *
 * - A filter holding a value is on the bar however it got that value. The
 *   shown list is the bar's own state and starts empty on every mount, while
 *   the values come back from persistence, a link or a seed; keyed on the
 *   state alone, the table stayed filtered behind an empty bar.
 * - The button is staged: it clears a set filter, and removes an empty one.
 * - An operator goes back to its default when its value empties by any
 *   route, not only the button - or it keeps counting as a filter while
 *   narrowing nothing.
 */
describe("AlephaTableFilterBar", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * Mounts a table whose bar has a Status list (with is / is not) and an
   * Owner text filter, seeded with `seed`. Returns the form the bar was
   * handed, so a spec can empty a value the way the list itself would.
   */
  const mount = async (seed?: Record<string, unknown>) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const handle: { form?: FormModel<ZObject> } = {};
    render(
      <AlephaContext.Provider value={alepha}>
        <AlephaTable<Row>
          data={rows}
          columns={columns}
          filters={{
            schema,
            seedValues: seed,
            render: (form) => {
              handle.form = form;
              return (
                <AlephaTableFilterBar
                  form={form}
                  search={{}}
                  fields={[
                    {
                      key: "status",
                      label: "Status",
                      operators: "is",
                      items: [
                        { value: "open", label: "Open" },
                        { value: "closed", label: "Closed" },
                      ],
                    },
                    { key: "owner", label: "Owner" },
                  ]}
                />
              );
            },
          }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return handle;
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
    // One text run, one space between each word: "Status not Closed".
    expect(trigger?.textContent).toBe("Status not Closed");
    expect(slot("owner")).toBeNull();
  });

  it("shows a filter holding only an operator, and keeps the operator", async () => {
    const handle = await mount({ statusOp: "not" });

    await waitFor(() => expect(slot("status")).toBeTruthy());
    // Restored on mount is not "emptied": nothing held a value before.
    expect(handle.form?.currentValues?.statusOp).toBe("not");
  });

  it("clears a set filter first, and removes it on the second press", async () => {
    const handle = await mount({ status: "open" });
    await waitFor(() => expect(slot("status")).toBeTruthy());

    fireEvent.click(
      screen.getByRole("button", { name: "Clear value: Status" }),
    );

    await waitFor(() =>
      expect(handle.form?.currentValues?.status).toBeUndefined(),
    );
    // Still on the bar, now offering the second act.
    expect(slot("status")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter: Status" }),
    );

    await waitFor(() => expect(slot("status")).toBeNull());
  });

  it("resets the operator when the value empties without the button", async () => {
    const handle = await mount({ status: "open", statusOp: "not" });
    await waitFor(() => expect(slot("status")).toBeTruthy());

    // What unticking the last value inside the list does: the value goes,
    // and nothing else is told.
    act(() => {
      (
        handle.form!.input as unknown as Record<
          string,
          { set: (value: unknown) => void }
        >
      ).status.set(undefined);
    });

    await waitFor(() =>
      expect(handle.form?.currentValues?.statusOp).toBeUndefined(),
    );
    // Emptied, not removed: the reader is still looking at it.
    expect(slot("status")).toBeTruthy();
  });
});
