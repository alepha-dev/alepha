import { Alepha } from "alepha";
import { AlephaOrm } from "alepha/orm";
import { describe, expect, it } from "vitest";
import { SigilIngestService } from "../src/api/services/SigilIngestService.ts";

/**
 * `eventTime` decides which hour bucket an event lands in. It is pure, so this
 * reaches it directly rather than through a database round trip.
 */
class TestSigilIngestService extends SigilIngestService {
  public testEventTime(ts: number | undefined, now: string): string {
    return this.eventTime(ts, now);
  }
}

const NOW = "2026-08-06T14:30:00.000Z";
const NOW_MS = Date.parse(NOW);

const service = () =>
  Alepha.create({
    env: { NODE_ENV: "test", APP_SECRET: "test-secret", SERVER_PORT: 0 },
  })
    .with(AlephaOrm)
    .inject(TestSigilIngestService);

describe("SigilIngestService.eventTime", () => {
  it("falls back to absorb time when the client sent none", () => {
    // Backward compatibility: a browser bundle predating the `ts` field must
    // keep working against an upgraded sink.
    expect(service().testEventTime(undefined, NOW)).toBe(NOW);
  });

  it("uses the client's time when it is credible", () => {
    // The point of the change: an event 40 seconds before the hour must not be
    // bucketed into the next hour just because the batch took a moment to
    // arrive.
    const justBeforeTheHour = Date.parse("2026-08-06T13:59:20.000Z");
    expect(service().testEventTime(justBeforeTheHour, NOW)).toBe(
      "2026-08-06T13:59:20.000Z",
    );
  });

  it("accepts a batch that waited, up to six hours", () => {
    const fiveHoursAgo = NOW_MS - 5 * 60 * 60 * 1000;
    expect(service().testEventTime(fiveHoursAgo, NOW)).toBe(
      new Date(fiveHoursAgo).toISOString(),
    );
  });

  it("discards a timestamp far in the past rather than rewriting history", () => {
    // The field is client-supplied and the token holder is not trusted with
    // it: inflating today's count is a property this data already has;
    // rewriting last month's chart is not.
    const lastMonth = NOW_MS - 30 * 24 * 60 * 60 * 1000;
    expect(service().testEventTime(lastMonth, NOW)).toBe(NOW);
  });

  it("discards a timestamp in the future beyond clock skew", () => {
    const nextWeek = NOW_MS + 7 * 24 * 60 * 60 * 1000;
    expect(service().testEventTime(nextWeek, NOW)).toBe(NOW);
  });

  it("tolerates ordinary client clock skew", () => {
    const twoMinutesFast = NOW_MS + 2 * 60 * 1000;
    expect(service().testEventTime(twoMinutesFast, NOW)).toBe(
      new Date(twoMinutesFast).toISOString(),
    );
  });

  it("discards a nonsensical epoch rather than bucketing at 1970", () => {
    expect(service().testEventTime(0, NOW)).toBe(NOW);
  });
});
