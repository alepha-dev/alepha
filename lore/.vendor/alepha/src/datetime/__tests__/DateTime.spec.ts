import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import {
  DateTime,
  DateTimeProvider,
  isDateTime,
} from "../providers/DateTimeProvider.ts";

describe("DateTime value class", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  const iso = "2026-03-15T12:30:45.123Z";

  it("should add and subtract with number + unit", () => {
    const time = create();
    const date = time.utc(iso);

    expect(date.add(90, "minute").toISOString()).toBe(
      "2026-03-15T14:00:45.123Z",
    );
    expect(date.subtract(45, "second").toISOString()).toBe(
      "2026-03-15T12:30:00.123Z",
    );
  });

  it("should add and subtract with a Duration", () => {
    const time = create();
    const date = time.utc(iso);
    const twoHours = time.duration([2, "hour"]);

    expect(date.add(twoHours).toISOString()).toBe("2026-03-15T14:30:45.123Z");
    expect(date.subtract(twoHours).toISOString()).toBe(
      "2026-03-15T10:30:45.123Z",
    );
  });

  it("should be immutable", () => {
    const time = create();
    const date = time.utc(iso);

    const later = date.add(1, "day");

    expect(later).not.toBe(date);
    expect(date.toISOString()).toBe(iso);
  });

  it("should compute startOf and endOf", () => {
    const time = create();
    const date = time.utc(iso);

    expect(date.startOf("day").toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(date.endOf("hour").toISOString()).toBe("2026-03-15T12:59:59.999Z");
  });

  it("should compare with isAfter, isBefore and isSame", () => {
    const time = create();
    const date = time.utc(iso);

    expect(date.isAfter("2026-03-14T00:00:00Z")).toBe(true);
    expect(date.isBefore("2026-03-16T00:00:00Z")).toBe(true);
    expect(date.isSame("2026-03-15T23:59:00Z", "day")).toBe(true);
    expect(date.isSame("2026-03-16T00:00:00Z", "day")).toBe(false);
    expect(date.isSame(date)).toBe(true);
  });

  it("should diff in the requested unit", () => {
    const time = create();
    const date = time.utc(iso);

    expect(date.diff("2026-03-15T10:30:45.123Z", "hour")).toBe(2);
    expect(date.diff(date.add(30, "minute"), "minute")).toBe(-30);
  });

  it("should serialize consistently", () => {
    const time = create();
    const date = time.utc(iso);

    expect(date.toJSON()).toBe(iso);
    expect(date.toString()).toBe(iso);
    expect(date.toISOString()).toBe(iso);
    expect(date.valueOf()).toBe(Date.parse(iso));
    expect(date.unix()).toBe(Math.floor(Date.parse(iso) / 1000));
    expect(date.toDate()).toBeInstanceOf(Date);
  });

  it("should identify DateTime instances", () => {
    const time = create();
    const date = time.of(iso);

    expect(isDateTime(date)).toBe(true);
    expect(isDateTime(new Date())).toBe(false);
    expect(time.isDateTime(date)).toBe(true);
    expect(time.isDateTime(iso)).toBe(false);
  });

  it("should return the same instance from of() for DateTime input", () => {
    const time = create();
    const date = time.of(iso);

    expect(time.of(date)).toBe(date);
    expect(date).toBeInstanceOf(DateTime);
  });
});

describe("Duration value class", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  it("should convert between units", () => {
    const time = create();
    const duration = time.duration([90, "minute"]);

    expect(duration.asMilliseconds()).toBe(5_400_000);
    expect(duration.asSeconds()).toBe(5400);
    expect(duration.asMinutes()).toBe(90);
    expect(duration.asHours()).toBe(1.5);
    expect(duration.as("hour")).toBe(1.5);
  });

  it("should build from a bare number of milliseconds", () => {
    const time = create();

    expect(time.duration(1500).asMilliseconds()).toBe(1500);
    expect(time.duration(2, "minute").asSeconds()).toBe(120);
  });

  it("should convert days and serialize to ISO", () => {
    const time = create();
    const duration = time.duration([36, "hour"]);

    expect(duration.asDays()).toBe(1.5);
    expect(time.duration([90, "second"]).toISOString()).toBe("PT1M30S");
  });
});
