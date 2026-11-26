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
  /**
   * What an action answers in place of its default, by name.
   */
  answers: Record<string, unknown> = {};

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) =>
        Object.assign(
          async () => {
            this.calls.push(name);
            if (name in this.answers) return this.answers[name];
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
    alepha.store.set(currentProjectAtom, project);
    alepha.store.set(projectDashboardAtom, {
      projectId: project.id,
      cards: [card(1), card(2)],
      values: [],
    });
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
  it("keeps a tile with nothing to show on the board for a reader, with its message, and hides only noAccess (#Q4402)", async () => {
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
    const values = [
      { cardId: 1, ok: true, value: 3, detail: {}, scopeNames: [] },
      { cardId: 2, ok: true, empty: "noJobs", detail: {}, scopeNames: [] },
      { cardId: 3, ok: true, empty: "noAccess", detail: {}, scopeNames: [] },
    ];
    const board = {
      projectId: project.id,
      cards: [card(1), card(2), card(3)],
      values,
    };
    const links = alepha.inject(LinkProvider) as FakeLinkProvider;
    links.answers = {
      getProjectDashboard: { computed: false, ...board },
      resolveProjectDashboardCards: {
        values,
        refreshedAt: "2026-09-14T10:00:00.000Z",
      },
    };
    alepha.store.set(currentProjectAtom, project);
    alepha.store.set(projectDashboardAtom, board as never);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectDashboard />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("dashboard-card")).toHaveLength(2),
    );
    const empty = screen.getByTestId("tile-empty");
    expect(empty.dataset.reason).toBe("noJobs");
    expect(empty.textContent).toBe("Nothing running right now.");
    expect(empty.querySelector("svg")).not.toBeNull();
    // The card keeps its normal look: no dashed, dimmed slot.
    const tile = empty.closest('[data-testid="dashboard-card"]') as HTMLElement;
    expect(tile.className).not.toContain("border-dashed");
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
    alepha.store.set(currentProjectAtom, projectFixture());

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
  /**
   * No Customize step (#Q3675): the computed board offers Edit and Add card
   * like a stored one, and Edit stores it first, in one write, then opens
   * edit mode on the stored copy.
   */
  it("offers Edit and Add card on a computed board, and stores it on Edit", async () => {
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
    const computedBoard = {
      projectId: project.id,
      computed: true,
      cards: [{ ...card(-1), slot: "flow" }],
      values: [{ cardId: -1, ok: true, value: 4, detail: {}, scopeNames: [] }],
    };
    const links = alepha.inject(LinkProvider) as FakeLinkProvider;
    links.answers = {
      getProjectDashboard: computedBoard,
      customizeProjectDashboard: { cards: [card(7)] },
    };
    alepha.store.set(currentProjectAtom, project);
    alepha.store.set(projectDashboardAtom, computedBoard);

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectDashboard />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const tile = await screen.findByTestId("dashboard-card");
    expect(tile.dataset.slot).toBe("flow");
    // Not stored yet: no card menu, and the header says so for tests.
    expect(screen.queryByLabelText("Card options")).toBeNull();
    expect(screen.getByTestId("dashboard-header").dataset.computed).toBe(
      "true",
    );
    expect(screen.queryByTestId("dashboard-customize")).toBeNull();
    // Icon buttons (#Q4442): the label is the accessible name, not text.
    const add = screen.getByTestId("dashboard-add");
    expect(add.getAttribute("aria-label")).toBe("Add card");
    expect(add.textContent).toBe("");
    const edit = screen.getByTestId("dashboard-edit");
    expect(edit.getAttribute("aria-label")).toBe("Edit");
    expect(links.calls).not.toContain("customizeProjectDashboard");

    // Once the stored copy is on screen, reads answer it.
    links.answers.getProjectDashboard = {
      computed: false,
      cards: [card(7)],
      values: [],
    };
    fireEvent.click(edit);

    await waitFor(() =>
      expect(links.calls).toContain("customizeProjectDashboard"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("dashboard-edit").getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(
      screen.getByTestId("dashboard-edit").getAttribute("aria-label"),
    ).toBe("Save");
    expect(
      links.calls.filter((it) => it === "customizeProjectDashboard"),
    ).toHaveLength(1);
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
    alepha.store.set(currentProjectAtom, project);
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
