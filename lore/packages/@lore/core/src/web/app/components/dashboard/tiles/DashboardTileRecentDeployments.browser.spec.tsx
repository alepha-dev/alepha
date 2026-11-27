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
import DashboardCard from "../DashboardCard.tsx";

const deployLink = (env: string) => ({
  route: "appDeploy",
  params: { projectSlug: "acme", app: "web", env },
});

const deployments: DashboardCardValue = {
  cardId: 1,
  ok: true,
  scopeNames: [],
  value: 3,
  rows: [
    {
      id: "web/staging",
      title: "1.2.0",
      badge: "failed",
      state: "bad",
      at: "2026-11-26T10:00:00.000Z",
      excerpt: "Ada",
      link: deployLink("staging"),
    },
    {
      id: "web/production",
      title: "1.0.0",
      badge: "rolledBack",
      state: "warn",
      at: "2026-11-26T09:00:00.000Z",
      link: deployLink("production"),
    },
    {
      id: "web/production",
      title: "1.1.0",
      badge: "succeeded",
      state: "ok",
      at: "2026-11-26T08:00:00.000Z",
      excerpt: "Ada",
      link: deployLink("production"),
    },
  ],
  detail: { failed: 1 },
  link: { route: "projectApps", params: { projectSlug: "acme" } },
};

const noop = () => {};

/**
 * The Deployments tile (#Q4522): a feed row per deployment, its copy as a
 * chip, its tag, its status as a pill in its tone and who started it, at
 * one row high and at two, and a calm line when nothing was deployed yet.
 */
describe("Deployments tile", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (value: DashboardCardValue, height: number) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <DashboardCard
          card={
            {
              id: 1,
              metric: "recentDeployments",
              scope: { kind: "projects", projectIds: [1] },
              filters: {},
              size: 2,
              height,
              position: 0,
            } as unknown as DashboardCardResource
          }
          value={value}
          labelKey="dashboard.metric.recentDeployments"
          icon="rocket"
          presentation="feed"
          armed={false}
          dragging={false}
          over={false}
          onArm={noop}
          onDisarm={noop}
          onDragStart={noop}
          onDragOver={noop}
          onDrop={noop}
          onDragEnd={noop}
          onChangeScope={noop}
          onDuplicate={noop}
          onRemove={noop}
        />
      </AlephaContext.Provider>,
    );
  };

  for (const height of [1, 2]) {
    it(`draws each deployment with its copy, tag, toned status and author at height ${height}`, async ({
      expect,
    }) => {
      await mount(deployments, height);

      expect(screen.getByText("Deployments")).toBeTruthy();
      const rows = screen.getAllByTestId("tile-row");
      expect(rows).toHaveLength(3);
      expect(rows[0]!.textContent).toContain("web/staging");
      expect(rows[0]!.textContent).toContain("1.2.0");
      expect(screen.getByText("failed").className).toContain(
        "text-danger-text",
      );
      expect(screen.getByText("rolled back").className).toContain(
        "text-warning-text",
      );
      expect(screen.getByText("succeeded")).toBeTruthy();
      expect(
        screen.getAllByTestId("tile-row-excerpt").map((it) => it.textContent),
      ).toEqual(["Ada", "Ada"]);
      expect(screen.getByText("See all")).toBeTruthy();
    });
  }

  it("says so when the scope has no deployment yet", async ({ expect }) => {
    await mount(
      {
        cardId: 1,
        ok: true,
        scopeNames: [],
        empty: "noDeployment",
        detail: {},
      },
      1,
    );

    expect(screen.getByTestId("tile-empty").dataset.reason).toBe(
      "noDeployment",
    );
    expect(screen.getByText("No deployment yet.")).toBeTruthy();
  });
});
