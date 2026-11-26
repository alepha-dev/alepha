import { I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import JobUsualBar from "./JobUsualBar.tsx";

const NOW = "2026-11-26T12:00:00.000Z";

/**
 * A clock stopped at {@link NOW}.
 */
class FixedClock extends DateTimeProvider {
  override nowMillis(): number {
    return Date.parse(NOW);
  }
}

/**
 * The time bar of a job with no steps (#Q4435): 90% at the 90th percentile
 * of its prompt's last runs and held there, the middle half in words.
 */
describe("JobUsualBar", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (secondsAgo: number) => {
    alepha = Alepha.create()
      .with({ provide: DateTimeProvider, use: FixedClock })
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <JobUsualBar
          usual={{ runs: 12, low: 60, high: 120, p90: 160 }}
          startedAt={new Date(
            Date.parse(NOW) - secondsAgo * 1000,
          ).toISOString()}
        />
      </AlephaContext.Provider>,
    );
  };

  it("fills toward 90% at the 90th percentile, with the middle half in words", async ({
    expect,
  }) => {
    await show(80);
    expect(screen.getByTestId("job-usual-fill").style.width).toBe("45%");
    expect(screen.getByTestId("job-usual-text").textContent).toBe(
      "Usually 1 min to 2 min",
    );
  });

  it("holds at 90% past the 90th percentile, never full while the job runs", async ({
    expect,
  }) => {
    await show(600);
    expect(screen.getByTestId("job-usual-fill").style.width).toBe("90%");
  });
});
