import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, ReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const pageOf = (rows: Row[]) => ({
  content: rows,
  page: {
    number: 0,
    size: 20,
    offset: 0,
    numberOfElements: rows.length,
    totalElements: rows.length,
    totalPages: 1,
    isEmpty: rows.length === 0,
    isFirst: true,
    isLast: true,
  },
});

const filterSchema = z.object({
  search: z.text().optional(),
  status: z.array(z.enum(["new", "triaged", "done"])).optional(),
});

class App {
  list = $page({
    path: "/list",
    component: () => <div>list</div>,
  });
}

/**
 * The toolbar's filter menu: Share, and the Reset that used to be a bare
 * icon button.
 *
 * Share is the write half of `fromQuery` and the only one there is: the
 * address bar is never written as the reader types (Lore incident #156), so
 * a link out of a filtered table has to be something the reader asks for.
 */
describe("AlephaTable (share filters)", () => {
  let alepha: Alepha | undefined;
  let copied: string[] = [];

  beforeAll(() => {
    setupJsdomMocks();
    // jsdom ships no clipboard. Defined here rather than spied on, per the
    // repo's no-`vi.mock` rule: this is a missing browser API, not a seam.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    copied = [];
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  const mount = async (url: string, ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);
    await act(async () => {
      await router.push(url);
    });
    return render(
      <AlephaContext.Provider value={alepha!}>{ui}</AlephaContext.Provider>,
    );
  };

  const table = (
    onFetch?: (filters?: Record<string, any>) => void,
    fromQuery = true,
  ) => (
    <AlephaTable<Row>
      columns={columns}
      filters={{
        schema: filterSchema,
        fromQuery,
        render: () => null,
      }}
      fetch={async (params) => {
        onFetch?.(params.filters);
        return pageOf([{ id: 1, title: "Alpha" }]);
      }}
    />
  );

  const openFilterMenu = async () => {
    const trigger = await screen.findByRole("button", { name: "Filters" });
    // Base UI opens a menu from its trigger on a key as well as a press; the
    // key path is the one jsdom drives reliably.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    return trigger;
  };

  it("copies a link carrying the filters that are on", async () => {
    await mount("/list?status=new", table());
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    await openFilterMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Share/ }));

    await waitFor(() => expect(copied.length).toBe(1));
    expect(copied[0]).toBe(`${window.location.origin}/list?status=new`);
  });

  it("keeps a query param the page owns in the copied link", async () => {
    await mount("/list?tab=open&status=new", table());
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    await openFilterMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Share/ }));

    await waitFor(() => expect(copied.length).toBe(1));
    expect(copied[0]).toBe(
      `${window.location.origin}/list?tab=open&status=new`,
    );
  });

  it("offers no link when nothing is filtered", async () => {
    // Sharing an unfiltered table is sharing the page's own URL, which the
    // address bar already holds.
    await mount("/list", table());
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    await openFilterMenu();

    const share = await screen.findByRole("menuitem", { name: /Share/ });
    expect(share.getAttribute("aria-disabled")).toBe("true");
  });

  it("still clears the filters, from the menu the icon button became", async () => {
    const seen: Array<Record<string, any> | undefined> = [];
    await mount(
      "/list?status=new",
      table((f) => seen.push(f)),
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(seen[0]?.status).toEqual(["new"]);

    await openFilterMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reset/ }));

    await waitFor(() =>
      expect(
        seen.at(-1)?.status === undefined || seen.at(-1)?.status?.length === 0,
      ).toBe(true),
    );
  });

  it("shares from the phone dialog too", async () => {
    // The dialog is the whole filter bar on a phone. Reset has always been in
    // it; a Share that existed only on desktop would make the link a
    // desktop-only idea.
    const matchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    try {
      await mount("/list?status=new", table());
      await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

      fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
      fireEvent.click(await screen.findByRole("button", { name: /Share/ }));

      await waitFor(() => expect(copied.length).toBe(1));
      expect(copied[0]).toBe(`${window.location.origin}/list?status=new`);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: matchMedia,
      });
    }
  });

  it("stays a bare icon, with no count on it", async () => {
    // The phone dialog badges its trigger because the filter bar is not on
    // screen behind it. On desktop the bar IS the indicator: the controls are
    // right there holding their values, so a count beside them says the same
    // thing twice and reads as a notification.
    await mount("/list?status=new&search=auth", table());
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    const trigger = await screen.findByRole("button", { name: "Filters" });
    expect(trigger.textContent).toBe("");
  });
});

/**
 * A table that never reads the query back.
 *
 * Sharing one would copy a link whose params do nothing on arrival, which is
 * worse than no Share at all: it looks like it worked. So the whole menu is
 * conditional on `fromQuery`, and a table without it keeps the bare Reset
 * button it has always had rather than paying a second click for a menu of
 * one item.
 */
describe("AlephaTable (filters that are not linkable)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);
    await act(async () => {
      await router.push("/list");
    });
    return render(
      <AlephaContext.Provider value={alepha!}>{ui}</AlephaContext.Provider>,
    );
  };

  const plainTable = (
    <AlephaTable<Row>
      columns={columns}
      filters={{
        schema: filterSchema,
        initialValues: { search: "auth" },
        render: () => null,
      }}
      fetch={async () => pageOf([{ id: 1, title: "Alpha" }])}
    />
  );

  it("offers no Share in the phone dialog either", async () => {
    const matchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    try {
      await mount(plainTable);
      await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

      fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
      await screen.findByRole("button", { name: /Reset/ });
      expect(screen.queryByRole("button", { name: /Share/ })).toBeNull();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: matchMedia,
      });
    }
  });

  it("keeps the bare Reset button, and offers no menu", async () => {
    await mount(plainTable);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();
  });
});
