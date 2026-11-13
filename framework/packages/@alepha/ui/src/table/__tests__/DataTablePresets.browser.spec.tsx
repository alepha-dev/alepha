import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, ReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import { presetMatches, sameFilterValue } from "../dataTablePresets.ts";
import type {
  DataTableFilterFields,
  DataTablePreset,
} from "../dataTableTypes.ts";

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

const fields = {
  search: { preset: "search" },
  status: {
    schema: z.array(z.enum(["todo", "doing", "done"])),
    label: "Status",
    mode: "default",
  },
  owner: {
    schema: z.enum(["me", "none"]),
    label: "Owner",
  },
  area: {
    schema: z.array(z.string()),
    label: "Area",
    mode: "default",
  },
} satisfies DataTableFilterFields;

const presets: DataTablePreset<typeof fields>[] = [
  {
    key: "mine",
    label: "Mine",
    values: { owner: "me", status: ["todo", "doing"] },
    count: 2,
  },
  {
    key: "done",
    label: "Done",
    values: { status: ["done"] },
    group: "later",
  },
];

class App {
  list = $page({
    path: "/list",
    component: () => <div>list</div>,
  });
}

const rail = () =>
  document.querySelector('[data-slot="data-table-presets"]') as HTMLElement;
const preset = (key: string) =>
  rail().querySelector(`[data-preset="${key}"]`) as HTMLButtonElement;
const slot = (key: string) => document.querySelector(`[data-filter="${key}"]`);

/**
 * `filters.presets`: a rail of named filter sets beside the table.
 *
 * A click is the whole filter (what the preset does not name is cleared, and
 * only its filters stay on the bar), a button is lit while the values are
 * exactly its own however they got there, and a link carrying filters
 * replaces the reader's stored ones, so a link can reproduce a preset.
 */
describe("DataTable (presets)", () => {
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

  const mount = async (
    url: `/${string}`,
    seen: Array<Record<string, any> | undefined>,
  ) => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);
    await act(async () => {
      await router.push(url);
    });
    return render(
      <AlephaContext.Provider value={alepha!}>
        <DataTable<Row, typeof fields>
          persistenceKey="probe"
          columns={columns}
          filters={{ fields, fromQuery: true, presets: { items: presets } }}
          fetch={async (params) => {
            seen.push(params.filters);
            return pageOf([{ id: 1, title: "Alpha" }]);
          }}
        />
      </AlephaContext.Provider>,
    );
  };

  it("draws a button per preset, a badge for a count, and All", async () => {
    await mount("/list", []);
    await waitFor(() => expect(rail()).toBeTruthy());

    expect(preset("mine").textContent).toContain("Mine");
    expect(
      preset("mine").querySelector('[data-slot="data-table-preset-count"]')
        ?.textContent,
    ).toBe("2");
    expect(
      preset("done").querySelector('[data-slot="data-table-preset-count"]'),
    ).toBeNull();
    // Nothing is filtered yet, so All is the lit one.
    expect(preset("all").getAttribute("aria-pressed")).toBe("true");
    expect(preset("mine").getAttribute("aria-pressed")).toBe("false");
  });

  it("sets exactly the preset's values and shows only its filters", async () => {
    const seen: Array<Record<string, any> | undefined> = [];
    await mount("/list", seen);
    await waitFor(() => expect(rail()).toBeTruthy());
    // Area is a default filter: on the bar before any preset.
    expect(slot("area")).toBeTruthy();

    fireEvent.click(preset("mine"));

    await waitFor(() =>
      expect(seen.at(-1)).toMatchObject({
        owner: "me",
        status: ["todo", "doing"],
      }),
    );
    expect(seen.at(-1)?.area).toBeUndefined();
    expect(preset("mine").getAttribute("aria-pressed")).toBe("true");
    expect(preset("all").getAttribute("aria-pressed")).toBe("false");
    // The bar is the preset's filters and nothing else.
    expect(slot("owner")).toBeTruthy();
    expect(slot("status")).toBeTruthy();
    expect(slot("area")).toBeNull();
    // Nothing reached the address bar.
    expect(window.location.search).toBe("");

    // The next preset replaces the first rather than adding to it.
    fireEvent.click(preset("done"));
    await waitFor(() =>
      expect(seen.at(-1)).toMatchObject({ status: ["done"] }),
    );
    expect(seen.at(-1)?.owner).toBeUndefined();
    expect(preset("mine").getAttribute("aria-pressed")).toBe("false");
    expect(preset("done").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(preset("all"));
    await waitFor(() => expect(seen.at(-1)?.status).toBeUndefined());
    expect(preset("all").getAttribute("aria-pressed")).toBe("true");
  });

  it("lights the preset a link's values match, and the link replaces stored filters", async () => {
    // A filter the reader set last time, which a link must not add to.
    window.localStorage.setItem(
      "probe.filters",
      JSON.stringify({ area: ["web"] }),
    );
    const seen: Array<Record<string, any> | undefined> = [];
    await mount("/list?status=doing,todo&owner=me", seen);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.area).toBeUndefined();
    expect(seen[0]?.status).toEqual(["doing", "todo"]);
    await waitFor(() =>
      expect(preset("mine").getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("keeps the stored filters when the link carries none", async () => {
    window.localStorage.setItem(
      "probe.filters",
      JSON.stringify({ area: ["web"] }),
    );
    const seen: Array<Record<string, any> | undefined> = [];
    await mount("/list", seen);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.area).toEqual(["web"]);
    expect(screen.queryByText("Alpha")).toBeTruthy();
  });
});

describe("preset matching", () => {
  it("compares lists as sets and empty as absent", () => {
    expect(sameFilterValue(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameFilterValue(["a"], "a")).toBe(true);
    expect(sameFilterValue([], undefined)).toBe(true);
    expect(sameFilterValue("", undefined)).toBe(true);
    expect(sameFilterValue(["a"], ["a", "b"])).toBe(false);
  });

  it("needs every other filter empty", () => {
    const keys = ["status", "area"];
    expect(presetMatches({ status: ["x"] }, { status: ["x"] }, keys)).toBe(
      true,
    );
    expect(
      presetMatches({ status: ["x"], area: ["web"] }, { status: ["x"] }, keys),
    ).toBe(false);
  });
});
