import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../index.ts";

describe("alepha.datetime.DateTimeProvider.utc", () => {
  it("runs in a time zone that is not UTC, so a local parse would show", () => {
    // The shared Vitest config pins TZ to Europe/Paris (UTC+1 on this date).
    // Without that, the assertions below could pass on a UTC machine for the
    // wrong reason.
    expect(new Date(2026, 2, 1).getTimezoneOffset()).not.toBe(0);
  });

  it("parses a plain date string as UTC midnight, not local midnight", () => {
    const dt = Alepha.create().inject(DateTimeProvider);

    const date = dt.utc("2026-03-01");

    expect(date.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(date.toISOString()).toBe(
      new Date(Date.UTC(2026, 2, 1)).toISOString(),
    );
    expect(date.format("YYYY-MM-DD")).toBe("2026-03-01");
  });

  it("walks a date range day by day without shifting", () => {
    const dt = Alepha.create().inject(DateTimeProvider);

    const days = [0, 1, 2].map((i) =>
      dt.utc("2026-03-28").add(i, "day").format("YYYY-MM-DD"),
    );

    expect(days).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
  });

  it("keeps the instant of a Date, a number and a DateTime", () => {
    const dt = Alepha.create().inject(DateTimeProvider);
    const millis = Date.UTC(2026, 2, 1, 12, 30);

    expect(dt.utc(new Date(millis)).toISOString()).toBe(
      "2026-03-01T12:30:00.000Z",
    );
    expect(dt.utc(millis).toISOString()).toBe("2026-03-01T12:30:00.000Z");
    expect(dt.utc(dt.of(millis)).format("YYYY-MM-DD HH:mm")).toBe(
      "2026-03-01 12:30",
    );
  });
});
