import { describe, expect, it } from "vitest";

import {
  adminStatTileDelta,
  formatAdminStatTileDelta,
} from "./adminStatTileDelta.ts";

describe("adminStatTileDelta", () => {
  it("is a rounded, signed percentage of the previous value", () => {
    expect(adminStatTileDelta(112, 100)).toEqual({
      kind: "percent",
      percent: 12,
    });
    expect(adminStatTileDelta(97, 100)).toEqual({
      kind: "percent",
      percent: -3,
    });
    expect(adminStatTileDelta(2, 3)).toEqual({ kind: "percent", percent: -33 });
  });

  it("says new when the previous value was 0, never Infinity", () => {
    expect(adminStatTileDelta(5, 0)).toEqual({ kind: "new" });
  });

  it("is flat when both are 0, never NaN", () => {
    expect(adminStatTileDelta(0, 0)).toEqual({ kind: "flat" });
  });

  it("is flat when the change rounds to 0, never -0", () => {
    expect(adminStatTileDelta(1000, 1001)).toEqual({ kind: "flat" });
  });
});

describe("formatAdminStatTileDelta", () => {
  it("prints the sign, the percent, or the new label", () => {
    expect(
      formatAdminStatTileDelta({ kind: "percent", percent: 12 }, "new"),
    ).toBe("+12%");
    expect(
      formatAdminStatTileDelta({ kind: "percent", percent: -3 }, "new"),
    ).toBe("-3%");
    expect(formatAdminStatTileDelta({ kind: "flat" }, "new")).toBe("0%");
    expect(formatAdminStatTileDelta({ kind: "new" }, "nouveau")).toBe(
      "nouveau",
    );
  });
});
