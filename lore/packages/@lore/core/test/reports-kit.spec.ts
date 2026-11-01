import { describe, it } from "vitest";

import { ReportsCsv } from "../src/web/app/services/ReportsCsv.ts";
import { ReportsDrillDown } from "../src/web/app/services/ReportsDrillDown.ts";

/**
 * The two behaviours of the kit that are logic rather than drawing (#Q2997).
 */
describe("ReportsCsv", () => {
  it("takes the union of the columns, so a sparse row keeps its place", ({
    expect,
  }) => {
    expect(
      new ReportsCsv().serialize([{ a: 1 }, { b: "two" }, { a: 3, b: "x" }]),
    ).toBe("a,b\n1,\n,two\n3,x");
  });

  it("quotes what a CSV needs quoted", ({ expect }) => {
    expect(new ReportsCsv().serialize([{ a: 'say "hi", ok' }])).toBe(
      'a\n"say ""hi"", ok"',
    );
  });

  it("defuses a title a spreadsheet would run, and leaves numbers alone", ({
    expect,
  }) => {
    expect(
      new ReportsCsv().serialize([{ title: "=HYPERLINK(1)", delta: -3 }]),
    ).toBe("title,delta\n'=HYPERLINK(1),-3");
  });
});

describe("ReportsDrillDown", () => {
  const drill = new ReportsDrillDown();

  it("merges the report's filters with the clicked segment", ({ expect }) => {
    expect(
      drill.query({ tag: "bug", releaseId: "4" }, { status: "in_progress" }),
    ).toEqual({ status: "in_progress", tag: "bug", release: "4" });
  });

  it("lets the segment win over the filter on the same axis", ({ expect }) => {
    expect(drill.query({ area: "api" }, { area: "ui" })).toEqual({
      area: "ui",
    });
  });

  it("carries nothing the list cannot filter on", ({ expect }) => {
    expect(
      drill.query({ priority: "high", memberId: "x", range: "7d" }, {}),
    ).toEqual({});
  });
});
