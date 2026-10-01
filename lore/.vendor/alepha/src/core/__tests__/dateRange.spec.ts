import { describe, expect, it } from "vitest";

import { coerceScalar } from "../helpers/coerceStrings.ts";
import { z } from "../providers/ZodProvider.ts";

/**
 * `z.dateRange()`: one field, one control, one query param.
 *
 * The shape is the decision. Both ends mandatory removes open bounds - the
 * only thing an array could not express - which is what lets `.optional()`
 * carry the whole absent case, so a half-written range is never a state.
 */
describe("z.dateRange", () => {
  it("accepts a closed pair of calendar days", () => {
    expect(z.dateRange().safeParse(["2026-01-01", "2026-01-31"]).success).toBe(
      true,
    );
  });

  it("refuses one end, three ends, and an empty end", () => {
    // ⚠️ `["2026-01-01", ""]` is the shape a string-joined range produces for
    // an open bound, and it is exactly what mandatory ends exist to prevent.
    expect(z.dateRange().safeParse(["2026-01-01"]).success).toBe(false);
    expect(
      z.dateRange().safeParse(["2026-01-01", "2026-01-15", "2026-01-31"])
        .success,
    ).toBe(false);
    expect(z.dateRange().safeParse(["2026-01-01", ""]).success).toBe(false);
  });

  it("refuses an end before its start", () => {
    expect(z.dateRange().safeParse(["2026-02-01", "2026-01-31"]).success).toBe(
      false,
    );
    // The two ends may be the same day: a one-day range is a range.
    expect(z.dateRange().safeParse(["2026-01-31", "2026-01-31"]).success).toBe(
      true,
    );
  });

  it("refuses an instant where a day is wanted", () => {
    expect(
      z.dateRange().safeParse(["2026-01-01T00:00:00.000Z", "2026-01-31"])
        .success,
    ).toBe(false);
  });

  /**
   * ⚠️ The tag sits on the ARRAY, not only on its items. Without it nothing
   * can tell a range from an ordinary list of two dates, and selecting the
   * range picker is the whole point.
   */
  it("tags the array itself with the date-range format", () => {
    expect(z.schema.format(z.dateRange())).toBe("date-range");
    expect(z.schema.isDateRange(z.dateRange())).toBe(true);
    // And the guard peels the wrappers, so an optional field still answers.
    expect(
      z.schema.isDateRange(z.schema.unwrap(z.dateRange().optional())),
    ).toBe(true);
    // A plain array of dates is NOT a range, which is the distinction the
    // format literal exists to draw.
    expect(z.schema.isDateRange(z.array(z.date()))).toBe(false);
  });

  /**
   * `.length(2)` and not `z.tuple([...])`: a tuple emits `prefixItems`
   * (JSON Schema 2020-12), which OpenAPI 3.0 consumers do not understand.
   */
  it("emits minItems/maxItems, never prefixItems", () => {
    const json = z.toJSONSchema(z.object({ r: z.dateRange() })) as any;
    const field = json.properties.r;
    expect(field.type).toBe("array");
    expect(field.minItems).toBe(2);
    expect(field.maxItems).toBe(2);
    expect(field.format).toBe("date-range");
    expect(field.items.format).toBe("date");
    expect(field).not.toHaveProperty("prefixItems");
  });

  /**
   * A query string cannot produce an array: `ServerProvider.parseQueryString`
   * answers `Record<string, string>`, so `?createdAt=a,b` reaches the schema
   * as one string.
   */
  describe("the query-string boundary", () => {
    it("splits a comma-joined pair for a date-range field", () => {
      expect(coerceScalar(z.dateRange(), "2026-01-01,2026-01-31")).toEqual([
        "2026-01-01",
        "2026-01-31",
      ]);
      // Through `.optional()` too, which is how every filter declares it.
      expect(
        coerceScalar(z.dateRange().optional(), "2026-01-01,2026-01-31"),
      ).toEqual(["2026-01-01", "2026-01-31"]);
    });

    /**
     * ⚠️ The OTHER shape a range arrives in, and the one that broke the first
     * implementation. `HttpClient.queryParams` `JSON.stringify`s any
     * object-valued query param, so the framework's own client sends
     * `?createdAt=["a","b"]` while a hand-written URL sends `?createdAt=a,b`.
     * Splitting the JSON one on commas cuts it in half and the schema fails
     * with "Invalid ISO date", naming nothing useful.
     */
    it("leaves the JSON form to the JSON branch", () => {
      expect(
        coerceScalar(z.dateRange(), '["2026-01-01","2026-01-31"]'),
      ).toEqual(["2026-01-01", "2026-01-31"]);
      expect(
        coerceScalar(z.dateRange().optional(), ' ["2026-01-01","2026-01-31"]'),
      ).toEqual(["2026-01-01", "2026-01-31"]);
    });

    it("hands a malformed value on for the schema to refuse by name", () => {
      // This file's contract: anything that cannot be coerced is passed
      // through so validation produces a proper rejection.
      expect(coerceScalar(z.dateRange(), "2026-01-01")).toEqual(["2026-01-01"]);
      expect(z.dateRange().safeParse(["2026-01-01"]).success).toBe(false);
    });

    /**
     * ⚠️ The scoping that makes this safe to add. No existing array query
     * field changes behaviour, and a value containing a comma cannot start
     * splitting by surprise.
     */
    it("leaves an ordinary array field alone", () => {
      expect(coerceScalar(z.array(z.date()), "2026-01-01,2026-01-31")).toBe(
        "2026-01-01,2026-01-31",
      );
      expect(coerceScalar(z.array(z.text()), "a,b")).toBe("a,b");
    });
  });
});
