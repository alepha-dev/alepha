import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { OwnedHostResource } from "../../../../api/schemas/ownedHostResourceSchema.ts";
import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import { I18n } from "../../services/I18n.ts";
import BayStats from "./BayStats.tsx";

const asked: Array<Record<string, unknown>> = [];
const answer = { collecting: true, points: [] as unknown[] };

class StatsLinks extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(
            async (input: { query?: Record<string, unknown> }) => {
              if (name !== "getHostStats") return {};
              asked.push(input.query ?? {});
              return {
                ...answer,
                grain: "day",
                estimated: false,
              };
            },
            { can: () => true },
          ),
      },
    );
  }
}

class Routes {
  bayStats = $page({
    name: "bayStats",
    path: "/:projectSlug/hosts/:hostSlug/stats",
    component: () => null,
  });
  baySettings = $page({
    name: "baySettings",
    path: "/:projectSlug/hosts/:hostSlug/settings",
    component: () => null,
  });
}

/**
 * A host's Stats tab (#Q4528): the chart over a range picked above it, the
 * last 30 days unless the address says otherwise, and each pick read again
 * from the server at its own grain.
 */
describe("BayStats", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    asked.length = 0;
    answer.collecting = true;
    window.history.replaceState({}, "", "/");
  });

  const show = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: StatsLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentHostAtom, {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "ovh-1",
      type: "bay",
      online: true,
      overdue: false,
      deployAllowed: false,
      jobsAllowed: false,
      agentHost: false,
      collectSeries: true,
      statsIntervalSeconds: 1800,
      acceptedRuntimes: ["node"],
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      project: { id: 7, title: "Acme", slug: "acme" },
      creator: { id: "00000000-0000-4000-8000-0000000000c1", name: "Builder" },
      can: ["host:read"],
      projects: [],
    } as OwnedHostResource);
    render(
      <AlephaContext.Provider value={alepha}>
        <BayStats />
      </AlephaContext.Provider>,
    );
  };

  it("opens on the last 30 days and reads again at each range picked", async ({
    expect,
  }) => {
    await show();
    expect((await screen.findByTestId("bay-stats-title")).textContent).toBe(
      "Last 30 days, by day",
    );
    expect(asked[0]).toEqual({ range: "month" });

    fireEvent.click(screen.getByRole("radio", { name: "Last hour" }));
    await waitFor(() =>
      expect(screen.getByTestId("bay-stats-title").textContent).toBe(
        "Last hour, by hour",
      ),
    );
    expect(asked.at(-1)).toEqual({ range: "hour" });
    // Kept in the address, so a link opens the same window.
    await waitFor(() => expect(window.location.search).toContain("range=hour"));

    fireEvent.click(screen.getByRole("radio", { name: "Today" }));
    await waitFor(() => expect(asked.at(-1)?.range).toBe("today"));
    // Today starts at the reader's midnight, which the page sends.
    expect(typeof asked.at(-1)?.since).toBe("string");
  });

  it("says the series is off, at any range", async ({ expect }) => {
    answer.collecting = false;
    await show();
    expect(
      await screen.findByText(/This machine is not recording a history/),
    ).toBeTruthy();
  });

  it("says nothing was measured yet in the window when recording", async ({
    expect,
  }) => {
    await show();
    expect(
      await screen.findByText(/nothing was measured in this window yet/),
    ).toBeTruthy();
  });
});
