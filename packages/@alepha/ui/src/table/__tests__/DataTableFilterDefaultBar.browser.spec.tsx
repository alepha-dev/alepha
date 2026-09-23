import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { CircleDot } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTablePersistedFacets,
} from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const rows: Row[] = [{ id: 1, title: "Alpha" }];

// Labels no select could derive from the values, so an option reading one
// proves `optionLabel` was asked.
const STATUS_LABELS = { open: "In progress", closed: "Finished" } as const;

/**
 * One field of each mode, and the shapes a bar has to classify: a search
 * preset (locked), an enum with its labels from `optionLabel` (default), an
 * enum with `items` (optional), and a plain text field (optional).
 */
const filterFields = {
  search: { preset: "search" },
  status: {
    schema: z.enum(["open", "closed"]),
    label: "Status",
    icon: CircleDot,
    mode: "default",
    operators: "is",
    optionLabel: (value: keyof typeof STATUS_LABELS) => STATUS_LABELS[value],
  },
  team: {
    schema: z.array(z.string()),
    label: "Team",
    items: ["Platform", "Design"],
  },
  owner: { schema: z.string(), label: "Owner" },
} satisfies DataTableFilterFields;

/**
 * The bar `DataTable` draws from `filters.fields` when there is no
 * `render` (#E58, #Q2314).
 *
 * What is under test is state rather than markup, so a refactor can break it
 * with every type still green: which filters a reader starts with, what they
 * did to the bar, what is remembered of it, and what Reset takes it back to.
 */
describe("DataTable (the filter bar drawn from fields)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
  });

  const start = async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const mount = async (
    options: {
      fields?: DataTableFilterFields;
      persistenceKey?: string;
      persist?: DataTablePersistedFacets;
      seedValues?: Record<string, unknown>;
    } = {},
  ) => {
    const app = alepha ?? (await start());
    const view = render(
      <AlephaContext.Provider value={app}>
        <DataTable<Row, DataTableFilterFields>
          data={rows}
          columns={columns}
          persistenceKey={options.persistenceKey}
          persist={options.persist}
          filters={{
            fields: options.fields ?? filterFields,
            seedValues: options.seedValues,
          }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return view;
  };

  const slot = (key: string) =>
    document.querySelector(`[data-filter="${key}"]`);

  const openAddMenu = async () => {
    const trigger = screen.getByRole("button", { name: "Add filters" });
    // Base UI opens a menu from its trigger on a key as well as a press; the
    // key path is the one jsdom drives reliably.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    return screen.findByRole("menu");
  };

  const addFilter = async (label: string) => {
    const menu = await openAddMenu();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(`^${label}`) }),
    );
  };

  /**
   * Reset lives in the toolbar's `Funnel` menu, on every table: this one is
   * not linkable, so the menu holds that item alone.
   */
  const openFilterMenu = async () => {
    const trigger = screen.getByRole("button", { name: "Filters" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    return screen.findByRole("menuitem", { name: "Reset filters" });
  };

  const closeFilterMenu = async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "Reset filters" }),
      ).toBeNull(),
    );
  };

  describe("modes", () => {
    it("starts with the locked and default filters, and no optional one", async () => {
      await mount();

      expect(slot("search")).toBeTruthy();
      expect(slot("status")).toBeTruthy();
      expect(slot("team")).toBeNull();
      expect(slot("owner")).toBeNull();
    });

    it("draws the search preset with the kit's placeholder, and no way to remove it", async () => {
      await mount();

      expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Remove filter: Search/ }),
      ).toBeNull();
      const menu = await openAddMenu();
      expect(
        within(menu).queryByRole("menuitem", { name: /^Search/ }),
      ).toBeNull();
    });

    it("lets a property written beside the preset win", async () => {
      await mount({
        fields: {
          search: { preset: "search", placeholder: "Search a tag" },
        },
      });

      expect(screen.getByPlaceholderText("Search a tag")).toBeTruthy();
    });

    it("sizes a text filter to its placeholder, never under 20 characters (#Q2408)", async () => {
      const placeholder = "Search a client, a court or an email";
      await mount({
        fields: { search: { preset: "search", placeholder } },
      });

      const input = screen.getByPlaceholderText(
        placeholder,
      ) as HTMLInputElement;
      expect(input.size).toBe(placeholder.length);
    });

    it("keeps the default width for a short placeholder", async () => {
      await mount();

      const input = screen.getByPlaceholderText("Search") as HTMLInputElement;
      expect(input.size).toBe(20);
    });

    it("offers the optional filters in the add menu, each with its kind", async () => {
      await mount();

      const menu = await openAddMenu();
      const items = within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent);
      // An array with items is a list, a plain string is text; the default
      // filter is already on the bar and not offered twice.
      expect(items).toEqual(["Teamlist", "Ownertext"]);
    });

    it("puts an added optional filter on the bar, after the locked one", async () => {
      await mount();

      await addFilter("Owner");

      await waitFor(() => expect(slot("owner")).toBeTruthy());
      const order = [...document.querySelectorAll("[data-filter]")].map((el) =>
        el.getAttribute("data-filter"),
      );
      expect(order).toEqual(["search", "status", "owner"]);
    });

    it("draws added filters in the order they were added, not declared", async () => {
      await mount();

      // Declared team then owner; added owner then team.
      await addFilter("Owner");
      await waitFor(() => expect(slot("owner")).toBeTruthy());
      await addFilter("Team");
      await waitFor(() => expect(slot("team")).toBeTruthy());

      const order = [...document.querySelectorAll("[data-filter]")].map((el) =>
        el.getAttribute("data-filter"),
      );
      expect(order).toEqual(["search", "status", "owner", "team"]);
    });

    it("removes a default filter with the staged cross, and offers it back", async () => {
      await mount();

      fireEvent.click(
        screen.getByRole("button", { name: "Remove filter: Status" }),
      );

      await waitFor(() => expect(slot("status")).toBeNull());
      const menu = await openAddMenu();
      expect(
        within(menu).getByRole("menuitem", { name: /^Status/ }),
      ).toBeTruthy();
    });
  });

  describe("the controls", () => {
    it("takes the options of an enum from its schema, labelled by optionLabel", async () => {
      await mount();

      fireEvent.keyDown(screen.getByRole("combobox", { name: "Status" }), {
        key: "ArrowDown",
      });

      expect(
        await screen.findByRole("option", { name: "In progress" }),
      ).toBeTruthy();
      expect(screen.getByRole("option", { name: "Finished" })).toBeTruthy();
    });

    it("names each control from its label", async () => {
      await mount({ seedValues: { owner: "ada" } });

      expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Owner" })).toBeTruthy();
    });
  });

  describe("hidden", () => {
    it("keeps an empty hidden filter off the bar and out of the menu", async () => {
      await mount({
        fields: {
          ...filterFields,
          status: { ...filterFields.status, hidden: true },
          team: { ...filterFields.team, hidden: true },
        },
      });

      expect(slot("status")).toBeNull();
      const menu = await openAddMenu();
      expect(
        within(menu).queryByRole("menuitem", { name: /^Team/ }),
      ).toBeNull();
    });

    it("still draws a hidden filter that narrows the list", async () => {
      await mount({
        fields: {
          ...filterFields,
          team: { ...filterFields.team, hidden: true },
        },
        seedValues: { team: ["Design"] },
      });

      await waitFor(() => expect(slot("team")).toBeTruthy());
    });
  });

  describe("remembered", () => {
    it("keeps a removed default and an added optional filter across a remount", async () => {
      const first = await mount({ persistenceKey: "probe" });
      fireEvent.click(
        screen.getByRole("button", { name: "Remove filter: Status" }),
      );
      await addFilter("Owner");
      await waitFor(() => expect(slot("owner")).toBeTruthy());

      expect(
        JSON.parse(window.localStorage.getItem("probe.filterVisibility")!),
      ).toEqual({ added: ["owner"], removed: ["status"] });

      first.unmount();
      await mount({ persistenceKey: "probe" });

      expect(slot("status")).toBeNull();
      expect(slot("owner")).toBeTruthy();
    });

    it("shows a default filter declared after the reader's change was stored", async () => {
      // Written by a release that had no `priority` filter yet. A stored list
      // would hide it; a stored change cannot.
      window.localStorage.setItem(
        "probe.filterVisibility",
        JSON.stringify({ added: ["owner"], removed: [] }),
      );

      await mount({
        persistenceKey: "probe",
        fields: {
          ...filterFields,
          priority: {
            schema: z.enum(["low", "high"]),
            label: "Priority",
            mode: "default",
          },
        },
      });

      expect(slot("priority")).toBeTruthy();
      expect(slot("owner")).toBeTruthy();
      expect(slot("status")).toBeTruthy();
    });

    it("ignores a stored change that no longer matches the fields", async () => {
      // `retired` is gone, the search box is locked, and `team` was removed
      // while it was a default filter and is optional now: none of them can
      // be moved by what was stored.
      window.localStorage.setItem(
        "probe.filterVisibility",
        JSON.stringify({
          added: ["retired", "status"],
          removed: ["search", "team"],
        }),
      );

      await mount({
        persistenceKey: "probe",
        fields: {
          ...filterFields,
          owner: { ...filterFields.owner, mode: "default" },
        },
      });

      expect(slot("search")).toBeTruthy();
      expect(slot("status")).toBeTruthy();
      expect(slot("owner")).toBeTruthy();
      expect(slot("team")).toBeNull();
    });

    it("stores nothing for a filter that joined the bar by holding a value", async () => {
      await mount({
        persistenceKey: "probe",
        seedValues: { team: ["Design"] },
      });

      await waitFor(() => expect(slot("team")).toBeTruthy());
      expect(window.localStorage.getItem("probe.filterVisibility")).toBeNull();
    });

    it("stores nothing with the filters facet off", async () => {
      await mount({ persistenceKey: "probe", persist: { filters: false } });

      await addFilter("Owner");
      await waitFor(() => expect(slot("owner")).toBeTruthy());

      expect(window.localStorage.getItem("probe.filterVisibility")).toBeNull();
    });

    it("re-reads the shown filters when the scope changes under a mounted table", async () => {
      window.localStorage.setItem(
        "project-a.filterVisibility",
        JSON.stringify({ added: ["owner"], removed: [] }),
      );
      window.localStorage.setItem(
        "project-b.filterVisibility",
        JSON.stringify({ added: ["team"], removed: ["status"] }),
      );

      const view = await mount({ persistenceKey: "project-a" });
      expect(slot("owner")).toBeTruthy();

      view.rerender(
        <AlephaContext.Provider value={alepha!}>
          <DataTable<Row, DataTableFilterFields>
            data={rows}
            columns={columns}
            persistenceKey="project-b"
            filters={{ fields: filterFields }}
          />
        </AlephaContext.Provider>,
      );

      await waitFor(() => expect(slot("team")).toBeTruthy());
      expect(slot("owner")).toBeNull();
      expect(slot("status")).toBeNull();
    });
  });

  describe("reset", () => {
    it("is offered once the bar differs from its declaration, with no value set", async () => {
      await mount({ persistenceKey: "probe" });
      expect((await openFilterMenu()).hasAttribute("data-disabled")).toBe(true);
      await closeFilterMenu();

      fireEvent.click(
        screen.getByRole("button", { name: "Remove filter: Status" }),
      );
      await waitFor(() => expect(slot("status")).toBeNull());

      expect((await openFilterMenu()).hasAttribute("data-disabled")).toBe(
        false,
      );
    });

    it("empties the values, removes the optional filters and shows the default ones", async () => {
      await mount({
        persistenceKey: "probe",
        seedValues: { owner: "ada" },
      });
      await waitFor(() => expect(slot("owner")).toBeTruthy());
      fireEvent.click(
        screen.getByRole("button", { name: "Remove filter: Status" }),
      );
      await waitFor(() => expect(slot("status")).toBeNull());
      expect(window.localStorage.getItem("probe.filterVisibility")).not.toBe(
        null,
      );

      fireEvent.click(await openFilterMenu());

      await waitFor(() => expect(slot("owner")).toBeNull());
      expect(slot("status")).toBeTruthy();
      expect(slot("search")).toBeTruthy();
      expect(window.localStorage.getItem("probe.filterVisibility")).toBeNull();
    });
  });

  describe("the add button", () => {
    it("carries a visible label while no filter is on screen, then turns back into a bare +", async () => {
      await mount({
        fields: {
          team: filterFields.team,
          owner: filterFields.owner,
        },
      });

      // Nothing locked and nothing default: the bar holds the button alone,
      // so it says what it adds, and needs no tooltip to say it.
      const labeled = screen.getByRole("button", { name: "Add filter" });
      expect(labeled.textContent).toContain("Add filter");

      fireEvent.keyDown(labeled, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("menuitem", { name: /Owner/ }));
      await waitFor(() => expect(slot("owner")).toBeTruthy());

      // A filter now sits beside it: back to the small "+".
      const bare = screen.getByRole("button", { name: "Add filters" });
      expect(bare.textContent).not.toContain("Add filter");
    });
  });

  describe("render", () => {
    it("draws no bar when the caller renders the filters", async () => {
      const app = await start();
      let rendered = false;
      render(
        <AlephaContext.Provider value={app}>
          <DataTable<Row, typeof filterFields>
            data={rows}
            columns={columns}
            filters={{
              fields: filterFields,
              render: (form) => {
                rendered = form.input.status !== undefined;
                return <span>custom filters</span>;
              },
            }}
          />
        </AlephaContext.Provider>,
      );
      await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

      expect(rendered).toBe(true);
      expect(screen.getByText("custom filters")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add filters" })).toBeNull();
      expect(slot("status")).toBeNull();
    });
  });

  describe("on a phone", () => {
    const matchMedia = window.matchMedia;

    afterEach(() => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: matchMedia,
      });
    });

    it("lists every filter in the dialog, each like a locked one", async () => {
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

      await mount();
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
      });

      const dialog = await screen.findByRole("dialog");
      const keys = [...dialog.querySelectorAll("[data-filter]")].map((el) =>
        el.getAttribute("data-filter"),
      );
      expect(keys).toEqual(["search", "status", "team", "owner"]);
      // The dialog stretches its form's children and grandchildren
      // (`[&>*]`, `[&>*>*]`), and jsdom lays nothing out, so the nesting that
      // selector reaches is what is pinned: form > the bar's `contents`
      // wrapper > the slot > the filter.
      const form = dialog.querySelector("form");
      for (const filter of dialog.querySelectorAll("[data-filter]")) {
        expect(filter.parentElement?.parentElement?.parentElement).toBe(form);
      }
      expect(
        within(dialog).queryByRole("button", { name: /Remove filter/ }),
      ).toBeNull();
      expect(
        within(dialog).queryByRole("button", { name: "Add filters" }),
      ).toBeNull();
    });
  });
});
