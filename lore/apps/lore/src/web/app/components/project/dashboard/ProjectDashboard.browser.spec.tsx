import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";
import { DashboardMetricCatalog } from "@/api/services/DashboardMetricCatalog.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { projectDashboardAtom } from "@/web/app/atoms/projectDashboardAtom.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import ProjectDashboard from "./ProjectDashboard.tsx";

/**
 * Answers the board's resolve, and refuses the reorder.
 */
class FakeLinkProvider extends LinkProvider {
  calls: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) =>
        Object.assign(
          async () => {
            this.calls.push(name);
            if (name === "reorderProjectDashboardCards") {
              throw new Error("The board order could not be saved (spec)");
            }
            if (name === "resolveProjectDashboardCards") {
              return { values: [], refreshedAt: "2026-09-14T10:00:00.000Z" };
            }
            return {};
          },
          { can: () => true },
        ),
    });
  }
}

const card = (id: number): DashboardCardResource =>
  ({
    id,
    metric: "activeQuests",
    scope: { kind: "all" },
    filters: {},
    size: 1,
    position: id,
  }) as unknown as DashboardCardResource;

/**
 * A reorder on the project board is a `useAction` that is quiet on purpose
 * (#E59, #Q2330): a refused order keeps the new order on screen and does not
 * toast, while the refusal still reaches error reporting.
 */
describe("ProjectDashboard", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("keeps a refused reorder on screen, and does not toast it", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(DashboardMetricCatalog);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const project = projectFixture();
    alepha.store.set(currentProjectAtom, project as never);
    alepha.store.set(projectDashboardAtom, {
      projectId: project.id,
      cards: [card(1), card(2)],
      values: [],
    } as never);
    const fake = alepha.inject(FakeLinkProvider);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <ProjectDashboard />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const tiles = await screen.findAllByTestId("dashboard-card");
    expect(tiles).toHaveLength(2);
    fireEvent.dragStart(tiles[1]);
    fireEvent.drop(tiles[0]);

    await waitFor(() =>
      expect(fake.calls).toContain("reorderProjectDashboardCards"),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      alepha.store.get(projectDashboardAtom).cards.map((it) => it.id),
    ).toEqual([2, 1]);
    expect(
      screen.queryByText("The board order could not be saved (spec)"),
    ).toBeNull();
  });
});
