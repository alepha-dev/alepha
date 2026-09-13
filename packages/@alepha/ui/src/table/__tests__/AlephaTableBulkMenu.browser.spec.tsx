import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AlephaTable,
  type BulkAction,
  type BulkMenuAction,
} from "../alepha-table.tsx";

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
 * The menu form of a bulk action. What is worth pinning:
 *
 * - the producer runs ONCE per selection, on open intent, and the menu shows
 *   what it produced;
 * - picking an item hands it the selection the pill counts;
 * - an empty producer says so inside the menu instead of opening nothing;
 * - an async producer shows a loading row until it settles.
 */
describe("AlephaTable (bulk menu action)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (action: BulkMenuAction<Row>) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <AlephaTable<Row>
          data={rows}
          columns={columns}
          bulkActions={[action]}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return view;
  };

  const selectFirstRow = () => {
    // The first checkbox is the header's select-all; the row ones follow.
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]);
  };

  const openMenu = (trigger: HTMLElement) => {
    // Base UI opens a menu from its trigger on a key as well as a press;
    // the key path is the one jsdom drives reliably.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  };

  it("resolves the items once, on open intent, and picks with the selection", async () => {
    let produced = 0;
    let picked: Row[] = [];
    await mount({
      label: "Add to release",
      items: () => {
        produced += 1;
        return [
          { label: "0.28.0", onClick: (selected) => void (picked = selected) },
          { label: "0.29.0", onClick: () => {} },
        ];
      },
    });

    selectFirstRow();
    const trigger = await screen.findByRole("button", {
      name: /Add to release/,
    });

    // Hover, focus and open: one resolve, not three.
    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);
    openMenu(trigger);

    const item = await screen.findByRole("menuitem", { name: "0.28.0" });
    expect(produced).toBe(1);

    fireEvent.click(item);
    expect(picked.map((row) => row.id)).toEqual([1]);
  });

  it("renders a disabled 'nothing to pick' row for an empty producer", async () => {
    await mount({ label: "Add to release", items: () => [] });

    selectFirstRow();
    const trigger = await screen.findByRole("button", {
      name: /Add to release/,
    });
    openMenu(trigger);

    const empty = await screen.findByRole("menuitem", {
      name: "Nothing to pick",
    });
    expect(empty.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows a loading row until an async producer settles", async () => {
    let settle: (items: BulkAction<Row>[]) => void = () => {};
    await mount({
      label: "Add to release",
      items: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });

    selectFirstRow();
    const trigger = await screen.findByRole("button", {
      name: /Add to release/,
    });
    openMenu(trigger);

    await screen.findByRole("menuitem", { name: /Loading/ });

    await act(async () => {
      settle([{ label: "0.28.0", onClick: () => {} }]);
    });

    await screen.findByRole("menuitem", { name: "0.28.0" });
    expect(screen.queryByRole("menuitem", { name: /Loading/ })).toBeNull();
  });

  it("resolves again for a new selection", async () => {
    let produced = 0;
    await mount({
      label: "Add to release",
      items: () => {
        produced += 1;
        return [{ label: "0.28.0", onClick: () => {} }];
      },
    });

    selectFirstRow();
    let trigger = await screen.findByRole("button", { name: /Add to release/ });
    fireEvent.pointerEnter(trigger);
    expect(produced).toBe(1);

    // A second row joins the selection: a new question.
    fireEvent.click(screen.getAllByRole("checkbox")[2]);
    trigger = await screen.findByRole("button", { name: /Add to release/ });
    fireEvent.pointerEnter(trigger);
    expect(produced).toBe(2);
  });
});
