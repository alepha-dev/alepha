import { DialogProvider } from "@alepha/ui";
import { I18n } from "@lore/core/web";
import { render, cleanup } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import { monitorListItemSchema } from "../src/api/schemas/monitorListItemSchema.ts";
import MonitorDetailBody from "../src/web/app/components/project/uptime/MonitorDetailBody.tsx";

/**
 * The detail body mounts the monitor's subscription bell (#Q3611), which asks
 * for a client; no project is set, so it draws nothing and calls nothing.
 */
class NoLinks extends LinkProvider {}

describe("Monitor detail body", () => {
  afterEach(cleanup);
  it("renders its uptime windows, latency chart, incidents and certificate expiry", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: LinkProvider, use: NoLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const monitor = monitorListItemSchema.parse({
      id: crypto.randomUUID(),
      version: 0,
      projectId: 1,
      createdAt: "2026-10-15T10:00:00Z",
      name: "Website",
      kind: "http",
      target: "https://example.test",
      intervalSecs: 60,
      timeoutSecs: 10,
      confirmations: 2,
      graceSecs: 1500,
      expect: {},
      notifications: { email: true, recipients: [] },
      active: true,
      status: "up",
      statusSince: "2026-10-15T10:00:00Z",
      failures: 0,
      nextCheckAt: "2026-10-15T10:01:00Z",
      lastLatencyMs: 120,
      lastResult: "latency",
      uptimePct: 75,
      beats: [
        {
          id: crypto.randomUUID(),
          at: "2026-10-15T10:00:00Z",
          ok: true,
          latencyMs: 120,
        },
      ],
    });
    try {
      const detail = {
        monitor: { ...monitor, certExpiresAt: "2027-01-15T10:00:00Z" },
        beats: monitor.beats,
        window: "7d" as const,
        bar: [
          {
            from: "2026-10-15T00:00:00Z",
            to: "2026-10-15T04:00:00Z",
            checks: 4,
            failures: 0,
          },
          {
            from: "2026-10-15T04:00:00Z",
            to: "2026-10-15T08:00:00Z",
            checks: 4,
            failures: 1,
          },
          {
            from: "2026-10-15T08:00:00Z",
            to: "2026-10-15T12:00:00Z",
            checks: 0,
            failures: 0,
          },
        ],
        uptime: (["24h", "7d", "30d"] as const).map((window) => ({
          window,
          uptimePct: 75,
        })),
        points: [
          { bucket: "2026-10-15T09", latencyMs: 100, count: 1 },
          { bucket: "2026-10-15T10", latencyMs: 120, count: 1 },
        ],
        incidents: [
          {
            id: crypto.randomUUID(),
            startedAt: "2026-10-15T09:00:00Z",
            endedAt: "2026-10-15T09:03:00Z",
            cause: "timeout",
            lastError: "Deadline exceeded",
            durationSecs: 180,
          },
        ],
        estimated: true,
      };
      const body = render(
        <AlephaContext.Provider value={alepha}>
          <DialogProvider>
            <MonitorDetailBody data={detail} />
          </DialogProvider>
        </AlephaContext.Provider>,
      );
      expect(body.getAllByText("75%")).toHaveLength(3);
      // The bar covers the selected window, not the last checks (#Q4009).
      expect(body.getByText("Checks over the last 7 days")).toBeTruthy();
      const slices = [
        ...body.getByTestId("monitor-period-bar").querySelectorAll("span"),
      ];
      expect(slices.map((it) => it.dataset.state)).toEqual([
        "up",
        "down",
        "none",
      ]);
      expect(slices[1]?.getAttribute("title")).toContain("4 checks, 1 failed");
      expect(body.getByRole("img", { name: "Mean latency" })).toBeTruthy();
      expect(body.getByText("Deadline exceeded")).toBeTruthy();
      expect(body.getByText("180 seconds: timeout")).toBeTruthy();
      expect(body.getByText(/Certificate expires/)).toBeTruthy();
      expect(body.getByText("Estimated from sampled history.")).toBeTruthy();
      body.rerender(
        <AlephaContext.Provider value={alepha}>
          <DialogProvider>
            <MonitorDetailBody data={{ ...detail, estimated: false }} />
          </DialogProvider>
        </AlephaContext.Provider>,
      );
      expect(body.queryByText("Estimated from sampled history.")).toBeNull();
    } finally {
      await alepha.stop();
    }
  });
});
