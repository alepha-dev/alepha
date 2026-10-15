import { I18n } from "@lore/core/web";
import { render, cleanup } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import { monitorListItemSchema } from "../src/api/schemas/monitorListItemSchema.ts";
import MonitorListRow from "../src/web/app/components/project/uptime/MonitorListRow.tsx";

describe("Monitor list row", () => {
  afterEach(cleanup);
  it("shows slow separately from down, renders uptime and beats, and disables every write while busy", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
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
      expect: {},
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
    const props = {
      monitor,
      canManage: true,
      busy: false,
      onEdit: () => {},
      onToggle: () => {},
      onDelete: () => {},
      onRotate: () => {},
    };
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <ul>
            <MonitorListRow {...props} />
          </ul>
        </AlephaContext.Provider>,
      );
      expect(await view.findByText("Website")).toBeTruthy();
      expect(view.getByText("Slow")).toBeTruthy();
      expect(view.getByText("75%")).toBeTruthy();
      expect(view.getByText("120 ms")).toBeTruthy();
      expect(view.getByLabelText("Recent checks").children).toHaveLength(1);
      view.rerender(
        <AlephaContext.Provider value={alepha}>
          <ul>
            <MonitorListRow {...props} busy />
          </ul>
        </AlephaContext.Provider>,
      );
      expect(
        view
          .getAllByRole("button")
          .every((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true);
    } finally {
      await alepha.stop();
    }
  });
});
