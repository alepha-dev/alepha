import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { beforeEach, describe, expect, it } from "vitest";
import type { BayApp } from "../src/api/services/BayControlService.ts";
import { quietLabel } from "../src/web/components/quietLabel.ts";

describe("quietLabel", () => {
  let dt: DateTimeProvider;

  /*
    Every instant here is expressed as an offset from now, never as a literal
    date. `DateTimeProvider` can freeze the clock and move it forward, but it
    cannot be pinned to a chosen absolute instant — so a test written against
    fixed dates passes today and silently starts asserting "5 months" where it
    meant "4" as real time advances past it.
  */
  const answeredDaysAgo = (days: number) =>
    dt.now().subtract(days, "day").toISOString();

  /**
   * The same offset, spelled as a Bay release directory name.
   */
  const deployedDaysAgo = (days: number) =>
    dt.now().subtract(days, "day").format("YYYY-MM-DD-HHmmss");

  const app = (over: Partial<BayApp> = {}): BayApp => ({
    name: "demo",
    env: "production",
    domain: "demo.example.com",
    release: deployedDaysAgo(1),
    port: 4000,
    runtime: "node",
    ...over,
  });

  beforeEach(async () => {
    const alepha = Alepha.create();
    dt = alepha.inject(DateTimeProvider);
    await alepha.start();
    // Frozen so the offsets above and the label computed inside quietLabel are
    // read from the same instant.
    dt.pause();
  });

  it("should say nothing about an app somebody used this morning", () => {
    expect(quietLabel(app({ lastRequestAt: answeredDaysAgo(0) }), dt)).toBe(
      undefined,
    );
  });

  it("should say nothing just under the threshold, so a quiet fortnight is not an accusation", () => {
    expect(quietLabel(app({ lastRequestAt: answeredDaysAgo(29) }), dt)).toBe(
      undefined,
    );
  });

  it("should call out an app nothing has touched in months", () => {
    expect(quietLabel(app({ lastRequestAt: answeredDaysAgo(120) }), dt)).toBe(
      "Quiet 4 months",
    );
  });

  /*
    The fallback that keeps the two ends of the scale apart. Both of the next
    two apps have never answered a request; only one is a deletion candidate,
    and without dating the silence from the deploy they render identically.
  */
  it("should not badge an app deployed moments ago that nobody has opened yet", () => {
    const fresh = app({
      release: deployedDaysAgo(0),
      lastRequestAt: undefined,
    });

    expect(quietLabel(fresh, dt)).toBe(undefined);
  });

  it("should badge an app deployed long ago and never once opened", () => {
    const forgotten = app({
      release: deployedDaysAgo(150),
      lastRequestAt: undefined,
    });

    expect(quietLabel(forgotten, dt)).toBe("Quiet 5 months");
  });

  /*
    An app whose whole job is a weekly mailer serves nobody and reads as the
    deadest thing on the host. The cron count is what stops it being deleted on
    that reading.
  */
  it("should report declared crons alongside the silence", () => {
    expect(
      quietLabel(app({ lastRequestAt: answeredDaysAgo(120), crons: 3 }), dt),
    ).toBe("Quiet 4 months · 3 crons");
  });

  it("should not pluralise a single cron", () => {
    expect(
      quietLabel(app({ lastRequestAt: answeredDaysAgo(120), crons: 1 }), dt),
    ).toBe("Quiet 4 months · 1 cron");
  });

  /*
    An older bay-go does not report `crons` at all, and absent means unknown,
    not none. Rendering "0 crons" would be a claim nobody made — and it is
    exactly the false reassurance that gets a working app deleted.
  */
  it("should claim nothing about crons when the server did not report them", () => {
    expect(quietLabel(app({ lastRequestAt: answeredDaysAgo(120) }), dt)).toBe(
      "Quiet 4 months",
    );
  });

  it("should say nothing at all when there is no date to reason from", () => {
    expect(
      quietLabel(app({ release: "unparseable", lastRequestAt: undefined }), dt),
    ).toBe(undefined);
  });
});
