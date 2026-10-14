import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { DashboardCardResource } from "../../../../../api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import type { DashboardPresentation } from "../../../../../api/schemas/DashboardMetricCatalog.ts";
import { I18n } from "../../../services/I18n.ts";
import DashboardTileBody from "./DashboardTileBody.tsx";

const card = (filters: Record<string, unknown> = {}) =>
  ({
    id: 1,
    metric: "anything",
    scope: { kind: "projects", projectIds: [1] },
    filters,
    size: 1,
    position: 0,
  }) as unknown as DashboardCardResource;

const value = (over: Partial<DashboardCardValue>): DashboardCardValue => ({
  cardId: 1,
  ok: true,
  detail: {},
  scopeNames: [],
  ...over,
});

describe("DashboardTileBody", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    presentation: DashboardPresentation,
    resolved?: DashboardCardValue,
    options: {
      filters?: Record<string, unknown>;
      chartStyle?: "area" | "bars";
    } = {},
  ) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    return render(
      <AlephaContext.Provider value={alepha}>
        <DashboardTileBody
          card={card(options.filters)}
          value={resolved}
          presentation={presentation}
          chartStyle={options.chartStyle}
        />
      </AlephaContext.Provider>,
    );
  };

  describe("states every renderer shares", () => {
    it("shows a skeleton before the resolve returns", async ({ expect }) => {
      await mount("list");
      expect(screen.getByTestId("tile-loading")).toBeTruthy();
    });

    it("says it failed rather than drawing a zero", async ({ expect }) => {
      await mount("chart", value({ ok: false }));
      expect(screen.getByTestId("tile-failed").textContent).toContain(
        "Unreadable",
      );
      expect(screen.queryByTestId("tile-chart")).toBeNull();
    });

    it("shows the empty reason, never the renderer", async ({ expect }) => {
      await mount("trend", value({ empty: "noBeacon", value: 0 }));
      const empty = screen.getByTestId("tile-empty");
      expect(empty.dataset.reason).toBe("noBeacon");
      expect(empty.textContent).toContain("page views");
      expect(screen.queryByTestId("dashboard-sparkline-end")).toBeNull();
    });
  });

  describe("scalar", () => {
    it("draws the delta as a direction and a sign", async ({ expect }) => {
      await mount("scalar", value({ value: 12, delta: -8 }));
      expect(screen.getByTestId("tile-delta").textContent).toBe("-8%");
    });
  });

  describe("trend", () => {
    it("ends the sparkline on the last reading, to scale from zero", async ({
      expect,
    }) => {
      await mount(
        "trend",
        value({
          value: 40,
          series: [
            { at: "2026-10-12", value: 20 },
            { at: "2026-10-13", value: 0 },
            { at: "2026-10-14", value: 40 },
          ],
        }),
      );
      const end = screen.getByTestId("dashboard-sparkline-end");
      expect(end.style.left).toBe("100%");
      expect(end.style.top).toBe("0%");
    });
  });

  describe("progress", () => {
    it("stacks the segments by their share", async ({ expect }) => {
      await mount(
        "progress",
        value({
          value: 75,
          segments: [
            { label: "done", value: 3, state: "ok" },
            { label: "todo", value: 1, state: "neutral" },
          ],
        }),
      );
      const parts = screen.getAllByTestId("tile-segment");
      expect(parts.map((it) => it.style.width)).toEqual(["75%", "25%"]);
    });
  });

  describe("list and feed", () => {
    it("renders typed references, titles and state pills", async ({
      expect,
    }) => {
      await mount(
        "list",
        value({
          rows: [
            { id: "Q12", title: "Fix login", badge: "held", state: "warn" },
            { id: "Q13", title: "Ship docs", meta: "Ana" },
          ],
        }),
      );
      const rows = screen.getAllByTestId("tile-row");
      expect(rows).toHaveLength(2);
      expect(rows[0]!.textContent).toContain("Q12");
      expect(rows[0]!.textContent).toContain("Fix login");
      expect(rows[1]!.textContent).toContain("Ana");
    });

    it("makes a row with a link a button", async ({ expect }) => {
      await mount(
        "feed",
        value({
          rows: [
            {
              id: "F3",
              title: "Decision",
              at: "2026-10-14T10:00:00.000Z",
              link: { route: "projectFolio", params: { shortId: "3" } },
            },
          ],
        }),
      );
      expect(
        screen.getByTestId("tile-row").querySelector("button"),
      ).toBeTruthy();
    });
  });

  describe("status", () => {
    it("draws one pill per row in its state", async ({ expect }) => {
      await mount(
        "status",
        value({
          rows: [
            { id: "club/production", title: "club", state: "ok" },
            { id: "club/staging", title: "club", state: "bad" },
          ],
        }),
      );
      const pills = screen.getAllByTestId("tile-status-pill");
      expect(pills.map((it) => it.dataset.state)).toEqual(["ok", "bad"]);
    });
  });

  describe("chart", () => {
    it("draws bars to scale and markers inside the window only", async ({
      expect,
    }) => {
      await mount(
        "chart",
        value({
          series: [
            { at: "2026-10-12T00:00:00.000Z", value: 2 },
            { at: "2026-10-13T00:00:00.000Z", value: 4 },
            { at: "2026-10-14T00:00:00.000Z", value: 0 },
          ],
          markers: [
            { at: "2026-10-13T00:00:00.000Z", kind: "deploy" },
            { at: "2026-09-01T00:00:00.000Z", kind: "deploy" },
          ],
        }),
        { chartStyle: "bars" },
      );
      const bars = screen.getAllByTestId("tile-chart-bar");
      expect(bars.map((it) => it.style.height)).toEqual(["50%", "100%", "2%"]);
      const markers = screen.getAllByTestId("tile-chart-marker");
      expect(markers).toHaveLength(1);
      expect(markers[0]!.style.left).toBe("50%");
    });
  });

  describe("note", () => {
    it("renders the card's own markdown without a resolve", async ({
      expect,
    }) => {
      await mount("note", undefined, { filters: { markdown: "**Read me**" } });
      expect(screen.getByTestId("tile-note").textContent).toContain("Read me");
    });
  });
});
