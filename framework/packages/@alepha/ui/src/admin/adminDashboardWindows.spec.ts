import { describe, expect, it } from "vitest";

import {
  adminAuditDayRange,
  adminDashboardDayWindow,
} from "./adminDashboardWindows.ts";

describe("adminDashboardDayWindow", () => {
  it("is 7 whole UTC days ending today, and the 7 before", () => {
    const now = Date.parse("2026-11-14T23:59:59.999Z");
    expect(adminDashboardDayWindow(now, 7)).toEqual({
      from: "2026-11-08",
      to: "2026-11-14",
      previousFrom: "2026-11-01",
      previousTo: "2026-11-07",
    });
  });

  it("turns at UTC midnight, not at the reader's", () => {
    expect(
      adminDashboardDayWindow(Date.parse("2026-11-15T00:00:00.000Z"), 7).to,
    ).toBe("2026-11-15");
    expect(
      adminDashboardDayWindow(Date.parse("2026-11-14T23:59:59.999Z"), 7).to,
    ).toBe("2026-11-14");
  });
});

describe("adminAuditDayRange", () => {
  it("covers the first to the last millisecond of a range of days, in UTC", () => {
    expect(adminAuditDayRange("2026-11-08", "2026-11-14")).toEqual({
      from: "2026-11-08T00:00:00.000Z",
      to: "2026-11-14T23:59:59.999Z",
    });
  });
});
