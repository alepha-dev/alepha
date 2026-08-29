import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { describe, it } from "vitest";

import { summariseVitalMetric } from "@/api/vitalsPercentile.ts";

import { I18n } from "../../../services/I18n.ts";
import AppVitalsCard from "./AppVitalsCard.tsx";

/**
 * The card, rendered against the shapes production actually produces.
 *
 * The seven enrolled apps measured on 2026-08-21 are the reason this quest
 * exists, and they are the cases worth pinning: a well-sampled app with an
 * overflow tail, an app whose whole reading rests on seven samples, and INP
 * empty (which it is for four of the seven, expected rather than broken).
 * Building the fixtures through `summariseVitalMetric` rather than by hand is
 * deliberate - the card is then tested against what the controller will
 * actually send it, not against a shape a test author imagined.
 */
describe("AppVitalsCard", () => {
  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    // The dictionaries are lazy chunks on a service, so nothing loads them
    // until something injects it. Asserting on English strings rather than on
    // raw keys is the point: this spec is about what the card SAYS.
    alepha.inject(I18n);
    await alepha.start();
    return alepha;
  };

  const show = async (
    histogram: Map<number, number> | undefined,
    metric: "lcp" | "inp" | "ttfb" = "lcp",
  ) => {
    const alepha = await mount();
    const thresholds = {
      lcp: { good: 2500, poor: 4000 },
      inp: { good: 200, poor: 500 },
      ttfb: { good: 800, poor: 1800 },
    }[metric];
    return render(
      <AlephaContext.Provider value={alepha}>
        <AppVitalsCard
          metricKey={metric}
          unit="ms"
          good={thresholds.good}
          poor={thresholds.poor}
          data={summariseVitalMetric(histogram, metric)}
        />
      </AlephaContext.Provider>,
    );
  };

  /**
   * lore's own LCP on the day this was measured: 270 samples, p75 in the
   * 1800 bucket. The old card printed "1,800 ms" and five of seven apps
   * printed the same figure, which is what made it read as fabricated.
   */
  it("prints a range and the sample count, never a bare boundary", async ({
    expect,
  }) => {
    const { getByText, queryByText } = await show(
      new Map([
        [0, 100],
        [1, 150],
        [2, 20],
      ]),
    );

    expect(getByText("1,000 to 1,800 ms")).toBeTruthy();
    expect(getByText("270 samples")).toBeTruthy();
    // The figure the old card showed, on its own, must not be the headline.
    expect(queryByText("1,800 ms")).toBeNull();
  });

  /**
   * docs-production's TTFB: 202 of 694 samples above every boundary, under a
   * headline that read `2000 ms` and said nothing about the tail.
   */
  it("says there is no ceiling when the p75 overflows every boundary", async ({
    expect,
  }) => {
    const { getByText } = await show(
      new Map([
        [0, 100],
        [6, 500],
      ]),
      "ttfb",
    );

    expect(getByText("over 2,000 ms")).toBeTruthy();
    expect(getByText("600 samples")).toBeTruthy();
  });

  /**
   * club-staging rated its LCP off seven samples, and mobile-staging off one.
   * Both cards were identical to the one built on 346.
   */
  it("refuses to rate a reading that rests on too few samples", async ({
    expect,
  }) => {
    const { getByText, queryByText } = await show(new Map([[1, 7]]));

    expect(getByText("Low confidence")).toBeTruthy();
    expect(getByText("7 samples")).toBeTruthy();
    expect(queryByText("Good")).toBeNull();
    expect(queryByText("Needs work")).toBeNull();
    expect(queryByText("Poor")).toBeNull();
  });

  it("rates a well-sampled reading from the bucket the p75 lands in", async ({
    expect,
  }) => {
    const { getByText } = await show(new Map([[1, 100]]));

    // Bucket 1 ceilings at 1800, inside LCP's 2500 "good" threshold.
    expect(getByText("Good")).toBeTruthy();

    const poor = await show(new Map([[5, 100]]));
    // Bucket 5 ceilings at 6000, past the 4000 "poor" threshold.
    expect(poor.getByText("Poor")).toBeTruthy();
  });

  /**
   * INP is empty for four of the seven apps because it needs a real
   * interaction to exist at all. An empty card reads as unfinished; saying so
   * reads as a state.
   */
  it("says INP has no interaction samples rather than rendering empty", async ({
    expect,
  }) => {
    const { getByText } = await show(undefined, "inp");

    expect(getByText("No interaction samples yet")).toBeTruthy();
    expect(getByText("0 samples")).toBeTruthy();
  });

  it("says a non-interaction metric simply has no samples yet", async ({
    expect,
  }) => {
    const { getByText } = await show(undefined, "lcp");

    expect(getByText("No samples yet")).toBeTruthy();
  });
});
