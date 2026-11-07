import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { DataTableTab } from "../DataTableTabs.tsx";

interface Row {
  id: number;
  title: string;
}

const rows: Row[] = [{ id: 1, title: "Alpha" }];

describe("DataTable (tabs)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (tabs?: DataTableTab[]) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row>
          rowKey={(r) => String(r.id)}
          data={rows}
          tabs={tabs}
          columns={{ title: { label: "Title", cell: (r: Row) => r.title } }}
        />
      </AlephaContext.Provider>,
    );
  };

  it("draws its tabs with their counts, the active one selected", async () => {
    const onSelect = vi.fn();
    await mount([
      { key: "users", label: "Users", count: 2, active: true },
      { key: "profiles", label: "Profiles", count: 4, onSelect },
    ]);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Users2", "Profiles4"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(tabs[1]!);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("renders a link tab as an anchor", async () => {
    await mount([{ key: "a", label: "A", href: "/a", active: true }]);
    const tab = await screen.findByRole("tab");
    expect(tab.tagName).toBe("A");
    expect(tab.getAttribute("href")).toBe("/a");
  });

  it("draws no band without tabs", async () => {
    await mount([]);
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
