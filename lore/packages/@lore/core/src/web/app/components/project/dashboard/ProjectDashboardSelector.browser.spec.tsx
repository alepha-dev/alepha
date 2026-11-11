import { DialogProvider } from "@alepha/ui";
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
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { DashboardCardResource } from "../../../../../api/schemas/dashboardCardResourceSchema.ts";
import { DashboardMetricCatalog } from "../../../../../api/schemas/DashboardMetricCatalog.ts";
import type { DashboardSummary } from "../../../../../api/schemas/dashboardSummarySchema.ts";
import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { projectDashboardAtom } from "../../../atoms/projectDashboardAtom.ts";
import { DashboardPickerRegistry } from "../../../registries/DashboardPickerRegistry.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectDashboard from "./ProjectDashboard.tsx";

/**
 * Records every call with its arguments, and answers a create, a rename and
 * a delete the way the server does.
 */
class FakeLinkProvider extends LinkProvider {
  calls: Array<{ name: string; args: any }> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const record =
      (name: string, answer: (args: any) => unknown = () => ({})) =>
      async (args: any) => {
        this.calls.push({ name, args });
        return answer(args);
      };
    return virtualClientFake({
      getProjectDashboard: record("getProjectDashboard", () => ({
        dashboard: { position: 0, first: true },
        dashboards: [{ position: 0, first: true }],
        computed: false,
        cards: [],
        values: [],
        refreshedAt: "2026-11-11T10:00:00.000Z",
      })),
      resolveProjectDashboardCards: record(
        "resolveProjectDashboardCards",
        () => ({ values: [], refreshedAt: "2026-11-11T10:00:00.000Z" }),
      ),
      createProjectDashboard: record("createProjectDashboard", (args) => ({
        id: 9,
        name: args.body.name,
        slug: "apps",
        position: 2,
        first: false,
      })),
      deleteProjectDashboard: record("deleteProjectDashboard", () => ({
        ok: true,
        deletedCards: 2,
      })),
      resetProjectDashboard: record("resetProjectDashboard"),
    });
  }
}

class Routes {
  projectDashboard = $page({
    name: "projectDashboard",
    path: "/:projectSlug",
    component: () => null,
  });
  projectDashboardNamed = $page({
    name: "projectDashboardNamed",
    path: "/:projectSlug/dashboards/:dashboardSlug",
    component: () => null,
  });
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

const FIRST: DashboardSummary = { id: 1, position: 0, first: true };
const WORK: DashboardSummary = {
  id: 2,
  name: "Work",
  slug: "work",
  position: 1,
  first: false,
};

/**
 * The selector on the left of the dashboard header (#E127, #Q3300): it
 * switches dashboards by linking, creates, renames and deletes one for a
 * member who may update the project, and lists them for everybody.
 */
describe("ProjectDashboardSelector", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: {
    dashboardKey?: string;
    /** The dashboard the atom holds, when it is not the route's. */
    heldKey?: string;
    dashboard?: DashboardSummary;
    dashboards?: DashboardSummary[];
    cards?: DashboardCardResource[];
    computed?: boolean;
    permissions?: string[];
  }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    alepha.inject(DashboardMetricCatalog);
    alepha.inject(DashboardPickerRegistry);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const project = projectFixture({
      slug: "acme",
      permissions: options.permissions,
    });
    alepha.store.set(currentProjectAtom, project);
    alepha.store.set(projectDashboardAtom, {
      projectId: project.id,
      dashboardKey: options.heldKey ?? options.dashboardKey ?? "",
      dashboard: options.dashboard ?? FIRST,
      dashboards: options.dashboards ?? [FIRST, WORK],
      computed: options.computed,
      cards: options.cards ?? [card(1), card(2)],
      values: [],
    });
    const fake = alepha.inject(FakeLinkProvider);
    const pushed: string[] = [];
    const router = alepha.inject(ReactRouter);
    router.push = (async (name: string, opts: any) => {
      pushed.push(router.path(name as any, opts));
    }) as any;

    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectDashboard dashboardKey={options.dashboardKey} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { fake, pushed };
  };

  const openMenu = async () => {
    fireEvent.click(await screen.findByTestId("dashboard-selector"));
    await screen.findAllByTestId("dashboard-selector-item");
  };

  it("names the first dashboard nobody named, and links every dashboard", async () => {
    await mount({});

    expect(
      (await screen.findByTestId("dashboard-selector-current")).textContent,
    ).toBe("Dashboard");
    await openMenu();
    const items = screen.getAllByTestId("dashboard-selector-item");
    expect(items.map((it) => it.textContent)).toEqual(["Dashboard", "Work"]);
    // Links, never a stored choice: the first is the project root.
    expect(items.map((it) => it.getAttribute("href"))).toEqual([
      "/acme",
      "/acme/dashboards/work",
    ]);
  });

  it("shows a reader the list and no write entry", async () => {
    await mount({ permissions: ["project:read"] });

    await openMenu();
    expect(screen.getAllByTestId("dashboard-selector-item")).toHaveLength(2);
    expect(screen.queryByTestId("dashboard-create")).toBeNull();
    expect(screen.queryByTestId("dashboard-rename")).toBeNull();
    expect(screen.queryByTestId("dashboard-delete")).toBeNull();
  });

  it("creates a dashboard and lands on it", async () => {
    const { fake, pushed } = await mount({});

    await openMenu();
    fireEvent.click(screen.getByTestId("dashboard-create"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "  Apps " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(pushed).toEqual(["/acme/dashboards/apps"]));
    const created = fake.calls.find(
      (it) => it.name === "createProjectDashboard",
    );
    expect(created?.args.body).toEqual({ name: "Apps" });
  });

  it("deletes the dashboard on screen, naming its cards, then lands on the first", async () => {
    const { fake, pushed } = await mount({
      dashboardKey: "work",
      dashboard: WORK,
    });

    await openMenu();
    fireEvent.click(screen.getByTestId("dashboard-delete"));
    expect(
      await screen.findByText(
        "Its 2 cards are deleted with it, for everyone in the project.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete dashboard" }));

    await waitFor(() => expect(pushed).toEqual(["/acme"]));
    const deleted = fake.calls.find(
      (it) => it.name === "deleteProjectDashboard",
    );
    expect(deleted?.args.query).toEqual({ dashboardId: WORK.id });
  });

  it("offers no delete on a project's single dashboard", async () => {
    await mount({ dashboards: [FIRST] });

    await openMenu();
    expect(screen.getByTestId("dashboard-create")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-delete")).toBeNull();
  });

  it("offers Reset to default on the first dashboard only", async () => {
    await mount({ dashboardKey: "work", dashboard: WORK });
    expect(await screen.findByTestId("dashboard-selector")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-menu")).toBeNull();
    cleanup();
    await alepha?.stop();

    await mount({});
    expect(await screen.findByTestId("dashboard-menu")).toBeTruthy();
  });

  it("keeps the bar on an empty dashboard when the project has more than one", async () => {
    await mount({ dashboardKey: "work", dashboard: WORK, cards: [] });
    expect(await screen.findByTestId("dashboard-empty")).toBeTruthy();
    expect(screen.getByTestId("dashboard-selector")).toBeTruthy();
    cleanup();
    await alepha?.stop();

    // A single empty board keeps its header-less page.
    await mount({ dashboards: [FIRST], cards: [] });
    expect(await screen.findByTestId("dashboard-empty")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-header")).toBeNull();
  });

  it("acts on the dashboard shown and paints no other dashboard's cards", async () => {
    // The atom still holds the first's cards while the route names Work.
    const { fake } = await mount({
      dashboardKey: "work",
      heldKey: "",
      dashboard: FIRST,
    });
    expect(screen.getByTestId("dashboard-loading")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-card")).toBeNull();
    await waitFor(() =>
      expect(
        fake.calls.find((it) => it.name === "getProjectDashboard")?.args.query
          .dashboard,
      ).toBe("work"),
    );
  });
});
