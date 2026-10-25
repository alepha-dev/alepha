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
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";

interface Row {
  id: number;
  name: string;
}

const columns = {
  name: { label: "Name", cell: (r: Row) => r.name },
};

const rows: Row[] = [{ id: 1, name: "Camille" }];

const notice = "Every payment is written once.";

/**
 * The `?` among the toolbar's icons (#Q2409): a hover card holding the page's
 * explanation, reachable by pointer, keyboard and touch.
 */
describe("DataTable help", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Camille")).toBeTruthy());
  };

  const help = () => screen.getByRole("button", { name: "Help" });

  it("sits last in the icon group, after refresh", async () => {
    await mount(
      <DataTable<Row> data={rows} columns={columns} help={<p>{notice}</p>} />,
    );

    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh.parentElement).toBe(help().parentElement);
    expect(refresh.nextElementSibling).toBe(help());
    // Closed until asked for.
    expect(screen.queryByText(notice)).toBeNull();
  });

  /**
   * Hover only. That the card stays open while the pointer crosses into it is
   * the primitive's safe polygon, which is geometry, and jsdom lays nothing
   * out: `apps/ui`'s e2e drives that in a browser, on the Addons page.
   */
  it("opens on hover, and closes when the pointer leaves", async () => {
    await mount(
      <DataTable<Row> data={rows} columns={columns} help={<p>{notice}</p>} />,
    );

    fireEvent.pointerEnter(help(), { pointerType: "mouse" });
    fireEvent.mouseEnter(help());
    await waitFor(() => expect(screen.getByText(notice)).toBeTruthy());

    fireEvent.mouseLeave(help());
    await waitFor(() => expect(screen.queryByText(notice)).toBeNull());
  });

  it("opens on keyboard focus", async () => {
    await mount(
      <DataTable<Row> data={rows} columns={columns} help={<p>{notice}</p>} />,
    );

    // A keydown first, so the focus that follows counts as a keyboard one.
    act(() => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      help().focus();
    });

    await waitFor(() => expect(screen.getByText(notice)).toBeTruthy());
  });

  it("opens on a click or a tap, and closes on Escape", async () => {
    await mount(
      <DataTable<Row> data={rows} columns={columns} help={<p>{notice}</p>} />,
    );

    fireEvent.click(help());
    await waitFor(() => expect(screen.getByText(notice)).toBeTruthy());

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByText(notice)).toBeNull());
  });

  it("draws a toolbar for help alone", async () => {
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        hideColumnPicker
        hideActionsMenu
        help={<p>{notice}</p>}
      />,
    );

    expect(help()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("draws no help button without help", async () => {
    await mount(<DataTable<Row> data={rows} columns={columns} />);

    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
  });
});
