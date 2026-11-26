import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { DashboardCardResource } from "../../../../../api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import { I18n } from "../../../services/I18n.ts";
import DashboardTileBody from "./DashboardTileBody.tsx";

const vitals = (rated: number): DashboardCardValue => ({
  cardId: 1,
  ok: true,
  scopeNames: [],
  value: 1,
  rows: [
    { id: "LCP 1–1.8 s", title: "LCP", state: "ok" },
    { id: "INP 400–500 ms", title: "INP", state: "warn" },
    {
      id: "CLS ≤ 0.05",
      title: "CLS",
      state: rated < 3 ? "neutral" : "ok",
    },
  ],
  detail: { days: 14, rated },
});

/**
 * The Web vitals tile (#Q4521): a pill per metric in its rating's tone, and
 * a footer that says over how long, and when a metric had too few samples
 * to be rated.
 */
describe("Web vitals tile", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (value: DashboardCardValue) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <DashboardTileBody
          card={
            {
              id: 1,
              metric: "webVitals",
              scope: { kind: "projects", projectIds: [1] },
              filters: {},
              size: 2,
              position: 0,
            } as unknown as DashboardCardResource
          }
          value={value}
          presentation="status"
        />
      </AlephaContext.Provider>,
    );
  };

  it("draws LCP, INP and CLS as pills in their tones, and the period", async ({
    expect,
  }) => {
    await mount(vitals(3));

    const pills = screen.getAllByTestId("tile-status-pill");
    expect(pills.map((it) => it.textContent)).toEqual([
      "LCP 1–1.8 s",
      "INP 400–500 ms",
      "CLS ≤ 0.05",
    ]);
    expect(pills.map((it) => it.dataset.state)).toEqual(["ok", "warn", "ok"]);
    expect(screen.getByText("p75 over 14 days")).toBeTruthy();
  });

  it("says how many metrics had enough samples to be rated", async ({
    expect,
  }) => {
    await mount(vitals(2));

    expect(screen.getAllByTestId("tile-status-pill")[2]!.dataset.state).toBe(
      "neutral",
    );
    expect(
      screen.getByText("p75 over 14 days, 2 of 3 with enough samples"),
    ).toBeTruthy();
  });
});
