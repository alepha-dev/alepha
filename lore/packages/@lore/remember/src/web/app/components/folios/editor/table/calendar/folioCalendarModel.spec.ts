import { describe, it } from "vitest";

import type { FolioRowResource } from "../../../../../../../api/schemas/folioRowResourceSchema.ts";
import {
  folioCellDay,
  folioMonthWeeks,
  folioMoveToDay,
  folioRowsByDay,
  folioShiftMonth,
  folioWeekStart,
} from "./folioCalendarModel.ts";

const row = (number: number, due: string | null): FolioRowResource => ({
  id: `r${number}`,
  number,
  position: number,
  version: 0,
  cells: { due },
  createdAt: "",
  updatedAt: "",
});

describe("folioCalendarModel", () => {
  it("starts the week on the locale's first day", ({ expect }) => {
    expect(folioWeekStart("fr")).toBe(1);
    expect(folioWeekStart("en-US")).toBe(7);
  });

  it("lays a month out in whole weeks from its first week", ({ expect }) => {
    // 1 November 2026 is a Sunday.
    const monday = folioMonthWeeks("2026-11", 1);
    expect(monday[0][0]).toBe("2026-10-26");
    expect(monday[0][6]).toBe("2026-11-01");
    expect(monday.at(-1)?.at(-1)).toBe("2026-12-06");
    const sunday = folioMonthWeeks("2026-11", 7);
    expect(sunday[0][0]).toBe("2026-11-01");
    expect(sunday).toHaveLength(5);
  });

  it("moves between months across a year", ({ expect }) => {
    expect(folioShiftMonth("2026-12", 1)).toBe("2027-01");
    expect(folioShiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("files a day-only row on its day, whatever the zone", ({ expect }) => {
    expect(folioCellDay("2026-11-20")).toBe("2026-11-20");
    expect(folioCellDay(null)).toBeUndefined();
    expect(folioCellDay("not a date")).toBeUndefined();
  });

  it("groups rows by day, day-only first, and lists the undated", ({
    expect,
  }) => {
    const { byDay, undated } = folioRowsByDay(
      [
        row(1, "2026-11-20T15:00:00.000Z"),
        row(2, "2026-11-20"),
        row(3, null),
        row(4, "2026-11-22"),
      ],
      "due",
    );
    const day = new Date("2026-11-20T15:00:00.000Z");
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (key === "2026-11-20") {
      expect(byDay.get("2026-11-20")?.map((r) => r.number)).toEqual([2, 1]);
    }
    expect(byDay.get("2026-11-22")?.map((r) => r.number)).toEqual([4]);
    expect(undated.map((r) => r.number)).toEqual([3]);
  });

  it("moves a day-only value to the day, and a timed one keeping its time", ({
    expect,
  }) => {
    expect(folioMoveToDay("2026-11-20", "2026-11-25")).toBe("2026-11-25");
    const moved = new Date(
      folioMoveToDay("2026-11-20T15:30:00.000Z", "2026-11-25"),
    );
    const before = new Date("2026-11-20T15:30:00.000Z");
    expect(moved.getHours()).toBe(before.getHours());
    expect(moved.getMinutes()).toBe(30);
    expect(moved.getDate()).toBe(25);
  });
});
