import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  type ReportsFilterKey,
  ReportsUrlQuery,
} from "../src/web/app/services/ReportsUrlQuery.ts";

const every: ReportsFilterKey[] = [
  "period",
  "grain",
  "compare",
  "area",
  "epicId",
  "releaseId",
  "tag",
  "priority",
  "memberId",
];

/**
 * The bar's URL (#Q2996): free text a stale bookmark can hold anything in.
 */
describe("ReportsUrlQuery", () => {
  const setup = () => {
    const alepha = Alepha.create();
    return {
      url: alepha.inject(ReportsUrlQuery),
      now: alepha.inject(DateTimeProvider),
    };
  };

  it("opens on the default period without the URL saying so", ({ expect }) => {
    const { url, now } = setup();

    const query = url.toQuery({}, every);

    expect(query.to).toBeUndefined();
    expect(
      Math.round((now.nowMillis() - Date.parse(query.from!)) / 86_400_000),
    ).toBe(30);
  });

  it("reads a preset as relative, and all as no bound", ({ expect }) => {
    const { url } = setup();

    expect(url.toQuery({ range: "7d" }, every).from).toBeDefined();
    expect(url.toQuery({ range: "all" }, every)).toEqual({});
  });

  it("reads a custom range as whole days", ({ expect }) => {
    const { url } = setup();

    expect(
      url.toQuery(
        { range: "custom", from: "2026-01-01", to: "2026-01-31" },
        every,
      ),
    ).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z",
    });
  });

  it("drops what it refuses instead of failing", ({ expect }) => {
    const { url } = setup();

    expect(
      url.toQuery(
        {
          range: "all",
          grain: "hourly",
          compare: "yes",
          epicId: "abc",
          priority: "urgent",
        },
        every,
      ),
    ).toEqual({});
  });

  it("gives a tab only the filters it declares", ({ expect }) => {
    const { url } = setup();

    expect(
      url.toQuery(
        { range: "7d", grain: "week", area: "api", compare: "true" },
        ["area"],
      ),
    ).toEqual({ area: "api" });
  });

  it("drops an emptied param, and a preset forgets a custom range", ({
    expect,
  }) => {
    const { url } = setup();

    expect(url.patch({ area: "api", tag: "bug" }, "area", undefined)).toEqual({
      tag: "bug",
    });
    expect(
      url.patch({ range: "custom", from: "a", to: "b" }, "range", "7d"),
    ).toEqual({ range: "7d" });
    expect(url.patch({}, "dates", ["2026-01-01", "2026-01-31"])).toEqual({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(url.patch({}, "compare", true)).toEqual({ compare: "true" });
  });
});
