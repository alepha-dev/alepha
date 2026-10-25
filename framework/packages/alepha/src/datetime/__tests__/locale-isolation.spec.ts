import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

describe("datetime locale isolation", () => {
  it("keeps each container's locale and supports immutable per-call overrides", ({
    expect,
  }) => {
    const first = Alepha.create().inject(DateTimeProvider);
    const second = Alepha.create().inject(DateTimeProvider);
    first.setLocale("fr");
    second.setLocale("en");
    const input = "2026-01-15T12:00:00Z";
    const localized = first.of(input);
    const month = localized.format("MMMM");
    expect(month).not.toBe("January");
    expect(second.of(input).format("MMMM")).toBe("January");
    expect(first.utc(input).format("MMMM")).toBe(month);
    expect(first.of(second.of(input)).format("MMMM")).toBe(month);
    expect(localized.locale("en").format("MMMM")).toBe("January");
    expect(localized.format("MMMM")).toBe(month);
    second.setLocale("ar");
    expect(first.of(input).format("MMMM")).toBe(month);
    const third = Alepha.create().inject(DateTimeProvider);
    expect(third.of(input).format("MMMM")).toBe("January");
    first.setLocale("en");
    expect(first.now().format("MMMM")).toBe(third.now().format("MMMM"));
  });
});
