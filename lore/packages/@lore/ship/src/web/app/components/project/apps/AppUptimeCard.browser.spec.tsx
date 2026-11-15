import { I18n } from "@lore/core/web";
import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { describe, it } from "vitest";

import type { MonitorListItem } from "../../../../../api/schemas/monitorListItemSchema.ts";
import AppUptimeCard from "./AppUptimeCard.tsx";

/**
 * The app overview's Uptime card (#Q3694): the percentage and the status
 * badge, and under them the recent checks the Apps list draws.
 */
describe("AppUptimeCard", () => {
  const show = async (beats: Array<{ ok: boolean }>) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    const monitor = {
      id: "m1",
      name: "lore (production)",
      active: true,
      status: "up",
      lastResult: "ok",
      uptimePct: 96.71,
      statusSince: "2026-11-15T10:00:00.000Z",
      beats: beats.map((beat, i) => ({
        id: `b${i}`,
        at: `2026-11-15T10:${String(i).padStart(2, "0")}:00.000Z`,
        ok: beat.ok,
        latencyMs: 120,
      })),
    } as unknown as MonitorListItem;
    return render(
      <AlephaContext.Provider value={alepha}>
        <AppUptimeCard monitor={monitor} />
      </AlephaContext.Provider>,
    );
  };

  it("draws one bar per recent check, green when it passed and red when it failed", async ({
    expect,
  }) => {
    const { getByTestId, getByText } = await show([
      { ok: true },
      { ok: false },
      { ok: true },
    ]);
    const bars = getByTestId("app-uptime-beats").querySelectorAll("span");
    expect([...bars].map((bar) => bar.className.includes("bg-red"))).toEqual([
      false,
      true,
      false,
    ]);
    // The percentage and the badge stay.
    expect(getByText(/96\.71%/)).toBeTruthy();
    expect(getByText("Up")).toBeTruthy();
  });

  it("says the monitor is not measured yet when it has no check", async ({
    expect,
  }) => {
    const { getByTestId } = await show([]);
    expect(getByTestId("app-uptime-beats").textContent).toMatch(/not/i);
  });
});
