import { DialogProvider } from "@alepha/ui";
import { I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { expectAccessible } from "alepha/testing/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FolioColumnResource } from "../../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../../api/schemas/folioRowResourceSchema.ts";
// Imported at the top: the document loads it as a lazy chunk.
import FolioTableCalendar, {
  type FolioTableCalendarProps,
} from "./FolioTableCalendar.tsx";

const columns: FolioColumnResource[] = [
  { id: "t", position: 0, name: "Title", type: "text", options: {} },
  { id: "d", position: 1, name: "Due", type: "date", options: {} },
];

const row = (number: number, title: string, due: string | null) =>
  ({
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    number,
    position: number,
    version: 0,
    cells: { t: title, d: due },
    createdAt: "",
    updatedAt: "",
  }) as FolioRowResource;

/**
 * The calendar view (#Q3518).
 */
describe("FolioTableCalendar", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: Partial<FolioTableCalendarProps> = {}) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const calls = {
      month: [] as string[],
      open: [] as number[],
      add: [] as string[],
      move: [] as Array<[number, string]>,
    };
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <FolioTableCalendar
            columns={columns}
            rows={[
              row(1, "Launch", "2026-11-20"),
              row(2, "Review", "2026-11-20"),
              row(3, "Retro", "2026-11-20"),
              row(4, "Ship", "2026-11-20"),
              row(5, "Someday", null),
            ]}
            dateColumnId="d"
            titleColumnId="t"
            readOnly={false}
            month="2026-11"
            today="2026-11-15"
            onMonth={(m) => calls.month.push(m)}
            onOpenRow={(r) => calls.open.push(r.number)}
            onAddOnDay={(d) => calls.add.push(d)}
            onMoveToDay={(r, d) => calls.move.push([r.number, d])}
            {...props}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return calls;
  };

  const day = (key: string) =>
    document.querySelector<HTMLElement>(`[data-day="${key}"]`)!;

  it("lays out the month with today marked and its entries on their day", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: /November 2026/ })).toBeTruthy();
    expect(day("2026-11-15").getAttribute("aria-current")).toBe("date");
    expect(day("2026-11-20").textContent).toContain("Launch");
    expect(day("2026-11-20").textContent).toContain("+2 more");
    expect(screen.getByText(/No date \(1\)/)).toBeTruthy();
    expect(screen.getAllByText("Someday").length).toBeGreaterThan(0);
  });

  it("opens a row, adds on a day, and moves an entry by dragging", async () => {
    const calls = await mount();
    fireEvent.click(screen.getAllByText("Launch")[0]);
    expect(calls.open).toEqual([1]);

    fireEvent.click(day("2026-11-03"));
    expect(calls.add).toEqual(["2026-11-03"]);

    const entry = day("2026-11-20").querySelector<HTMLElement>(
      '[data-row-number="1"]',
    )!;
    fireEvent.dragStart(entry, { dataTransfer: { effectAllowed: "" } });
    fireEvent.dragOver(day("2026-11-24"));
    fireEvent.drop(day("2026-11-24"));
    expect(calls.move).toEqual([[1, "2026-11-24"]]);
  });

  it("opens the day's list from +N more, and navigates months", async () => {
    const calls = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(calls.month).toEqual(["2026-12", "2026-10"]);
    fireEvent.click(screen.getByText("+2 more"));
    expect(screen.getAllByText("Ship").length).toBeGreaterThan(0);
  });

  it("moves between days with the arrows and opens one with Enter", async () => {
    await mount();
    const grid = screen.getByRole("grid");
    day("2026-11-15").focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(
      screen.getByRole("heading", { name: /November 23, 2026/ }),
    ).toBeTruthy();
  });

  it("names every day and entry for a screen reader", async () => {
    await mount();
    expect(day("2026-11-20").getAttribute("aria-label")).toMatch(
      /November 20, 2026, 4 entries/,
    );
    await expectAccessible();
  });
});
