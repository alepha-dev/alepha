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

const backupsLink = (app: string) => ({
  route: "appBackups",
  params: { projectSlug: "acme", app, env: "production" },
});

const backups: DashboardCardValue = {
  cardId: 1,
  ok: true,
  scopeNames: [],
  value: 1,
  rows: [
    {
      id: "api/production",
      title: "1.9 MB",
      badge: "backupFailing",
      state: "bad",
      at: "2026-11-26T10:00:00.000Z",
      link: backupsLink("api"),
    },
    {
      id: "docs/production",
      title: "12 MB",
      badge: "backupStale",
      state: "warn",
      at: "2026-11-20T10:00:00.000Z",
      link: backupsLink("docs"),
    },
    {
      id: "web/production",
      title: "48 MB",
      state: "ok",
      at: "2026-11-26T08:00:00.000Z",
      link: backupsLink("web"),
    },
  ],
  detail: { copies: 3 },
  link: { route: "projectApps", params: { projectSlug: "acme" } },
};

const noop = () => {};

/**
 * The Backups tile (#Q4523): a row per backed up copy, its size and the
 * age of its last snapshot, a failing one red and a stale one amber, and a
 * calm line when no copy is backed up.
 */
describe("Backups tile", () => {
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
        <DashboardCard
          card={
            {
              id: 1,
              metric: "backupFreshness",
              scope: { kind: "projects", projectIds: [1] },
              filters: {},
              size: 1,
              position: 0,
            } as unknown as DashboardCardResource
          }
          value={value}
          labelKey="dashboard.metric.backupFreshness"
          icon="database-backup"
          presentation="list"
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

  it("draws each copy's size and age, failing in red and stale in amber", async ({
    expect,
  }) => {
    await mount(backups);

    expect(screen.getByText("Backups")).toBeTruthy();
    const rows = screen.getAllByTestId("tile-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("api/production");
    expect(rows[0]!.textContent).toContain("1.9 MB");
    expect(screen.getByText("failing").className).toContain("text-danger-text");
    expect(screen.getByText("stale").className).toContain("text-warning-text");
    // A fresh backup carries no pill.
    expect(rows[2]!.textContent).not.toMatch(/failing|stale/);
    expect(screen.getByText("See all")).toBeTruthy();
  });

  it("says so when no copy in scope is backed up", async ({ expect }) => {
    await mount({
      cardId: 1,
      ok: true,
      scopeNames: [],
      empty: "noBackup",
      detail: {},
    });

    expect(screen.getByTestId("tile-empty").dataset.reason).toBe("noBackup");
    expect(screen.getByText("No app instance here is backed up.")).toBeTruthy();
  });
});
