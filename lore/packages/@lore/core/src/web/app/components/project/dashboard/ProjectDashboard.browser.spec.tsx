import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { DashboardCardResource } from "../../../../../api/schemas/dashboardCardResourceSchema.ts";
import { DashboardMetricCatalog } from "../../../../../api/schemas/DashboardMetricCatalog.ts";
import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { projectDashboardAtom } from "../../../atoms/projectDashboardAtom.ts";
import { DashboardPickerRegistry } from "../../../registries/DashboardPickerRegistry.ts";
import { I18n } from "../../../services/I18n.ts";
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
            if (name === "getProjectDashboard") {
              return { computed: false, cards: [], values: [] };
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
    // The pickers Work and Deploy register (#E75, #Q2624); none open here.
    alepha.inject(DashboardPickerRegistry);
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
  it("shows a skeleton, not the empty state, until the board is read", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(DashboardMetricCatalog);
    alepha.inject(DashboardPickerRegistry);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    // The atom holds no board for this project yet: the read is in flight.
    alepha.store.set(currentProjectAtom, projectFixture() as never);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectDashboard />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    // ⚠️ Every open used to flash the centred Add card here.
    expect(screen.getByTestId("dashboard-loading")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-empty")).toBeNull();
    // The read answers no cards: now, and only now, the empty state.
    expect(await screen.findByTestId("dashboard-empty")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-loading")).toBeNull();
  });
  it("renders a computed board read-only, with no card menu or edit mode", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(DashboardMetricCatalog);
    alepha.inject(DashboardPickerRegistry);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const project = projectFixture();
    alepha.store.set(currentProjectAtom, project as never);
    alepha.store.set(projectDashboardAtom, {
      projectId: project.id,
      computed: true,
      cards: [{ ...card(-1), slot: "flow" }],
      values: [{ cardId: -1, ok: true, value: 4, detail: {}, scopeNames: [] }],
    } as never);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectDashboard />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const tile = await screen.findByTestId("dashboard-card");
    expect(tile.dataset.slot).toBe("flow");
    expect(screen.queryByLabelText("Card options")).toBeNull();
    expect(screen.queryByTestId("dashboard-add")).toBeNull();
  });
  it("renders an archived project's notice and loads no board", async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(DashboardMetricCatalog);
    alepha.inject(DashboardPickerRegistry);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const project = {
      ...projectFixture(),
      archivedAt: "2026-09-01T00:00:00.000Z",
      // No Knowledge and no Work: the notice has nowhere to link, and this
      // spec registers neither router. The link is the e2e's.
      capabilities: [],
    };
    alepha.store.set(currentProjectAtom, project as never);
    const fake = alepha.inject(FakeLinkProvider);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectDashboard />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    expect(await screen.findByTestId("dashboard-archived")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-card")).toBeNull();
    // Rendered, never redirected (#Q2662), and nothing to resolve.
    expect(fake.calls).not.toContain("getProjectDashboard");
  });
});
