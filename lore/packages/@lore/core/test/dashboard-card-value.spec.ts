import { describe, it } from "vitest";

import { dashboardCardValueSchema } from "../src/api/schemas/dashboardCardValueSchema.ts";

describe("dashboardCardValueSchema", () => {
  it("still parses the v1 shape, with none of the #E77 fields", ({
    expect,
  }) => {
    const parsed = dashboardCardValueSchema.parse({
      cardId: 1,
      ok: true,
      value: 12,
      delta: -4,
      detail: { todoCount: 3 },
      scopeNames: [],
    });

    expect(parsed.value).toBe(12);
    expect(parsed.series).toBeUndefined();
    expect(parsed.rows).toBeUndefined();
    expect(parsed.empty).toBeUndefined();
  });

  it("carries series, markers, rows and segments", ({ expect }) => {
    const parsed = dashboardCardValueSchema.parse({
      cardId: 2,
      ok: true,
      detail: {},
      scopeNames: [],
      series: [
        { at: "2026-10-13", value: 4 },
        { at: "2026-10-14", value: 7 },
      ],
      markers: [{ at: "2026-10-14T09:00:00.000Z", kind: "deploy" }],
      rows: [
        {
          id: "Q2641",
          title: "Fix the thing",
          badge: "held",
          state: "warn",
          link: { route: "projectQuest", params: { shortId: "2641" } },
        },
      ],
      segments: [
        { label: "done", value: 18, state: "ok" },
        { label: "todo", value: 6 },
      ],
    });

    expect(parsed.series).toHaveLength(2);
    expect(parsed.markers?.[0]?.kind).toBe("deploy");
    expect(parsed.rows?.[0]?.state).toBe("warn");
    expect(parsed.segments?.[1]?.state).toBeUndefined();
  });

  it("keeps empty, failed and a measured zero apart", ({ expect }) => {
    const empty = dashboardCardValueSchema.parse({
      cardId: 3,
      ok: true,
      detail: {},
      scopeNames: [],
      empty: "noRelease",
    });
    const zero = dashboardCardValueSchema.parse({
      cardId: 4,
      ok: true,
      value: 0,
      detail: {},
      scopeNames: [],
    });

    expect(empty.empty).toBe("noRelease");
    expect(empty.value).toBeUndefined();
    expect(zero.empty).toBeUndefined();
    expect(zero.value).toBe(0);
  });

  it("refuses a state or an empty reason outside the closed set", ({
    expect,
  }) => {
    const base = { cardId: 5, ok: true, detail: {}, scopeNames: [] };

    expect(() =>
      dashboardCardValueSchema.parse({ ...base, empty: "nothing" }),
    ).toThrow();
    expect(() =>
      dashboardCardValueSchema.parse({
        ...base,
        rows: [{ title: "x", state: "purple" }],
      }),
    ).toThrow();
  });
});
