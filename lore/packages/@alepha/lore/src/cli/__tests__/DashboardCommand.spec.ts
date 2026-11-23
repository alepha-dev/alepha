import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { DashboardCommand } from "../commands/DashboardCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

const SIGIL = "01900000-0000-7000-8000-0000000000aa";

/**
 * `lore dashboard` (#Q4206), each verb on the action the board's edit mode
 * calls. The gates are the actions' own, proved by the MCP spec on a real
 * server; here, that the CLI sends what it should and refuses bad input
 * before any request.
 */
describe("lore dashboard", () => {
  const create = () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const sent: Array<[string, unknown]> = [];
    const record =
      (name: string, answer: (request: any) => unknown) =>
      async (request: unknown) => {
        sent.push([name, request]);
        return answer(request);
      };
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: {
          getProjectBySlug: async () => ({ id: 7 }),
          getProjectById: async () => ({ id: 7 }),
        },
      },
    );
    const card = (request: any) => ({
      id: 3,
      metric: request.body?.metric ?? "uniqueVisitors",
      scope: request.body?.scope ?? { kind: "projects", projectIds: [7] },
      filters: {},
      size: request.body?.size ?? 1,
      position: 0,
    });
    const dashboard = alepha.inject(DashboardCommand);
    Object.assign(dashboard as unknown as Record<string, unknown>, {
      api: {
        listProjectDashboards: record("listProjectDashboards", () => ({
          dashboards: [{ id: 1, name: "Main", position: 0, first: true }],
        })),
        listProjectDashboardMetrics: record(
          "listProjectDashboardMetrics",
          () => ({
            metrics: [
              {
                key: "uniqueVisitors",
                scopeKinds: ["apps", "projects"],
                defaultFilters: { period: "window" },
                needs: { capability: "ship", option: "track" },
              },
            ],
          }),
        ),
        listProjectDashboardCards: record("listProjectDashboardCards", () => ({
          cards: [],
        })),
        addProjectDashboardCard: record("addProjectDashboardCard", card),
        updateProjectDashboardCard: record("updateProjectDashboardCard", card),
        removeProjectDashboardCard: record(
          "removeProjectDashboardCard",
          () => ({ ok: true }),
        ),
        reorderProjectDashboardCards: record(
          "reorderProjectDashboardCards",
          () => ({ cards: [] }),
        ),
      },
      sigilApi: {
        listSigils: record("listSigils", () => ({
          items: [{ id: SIGIL, name: "docs" }],
        })),
      },
    });
    const run = async (command: any, argv: string) => {
      await alepha.inject(CliProvider).run(command, { argv });
    };
    return { run, printed, sent, dashboard };
  };

  it("lists the dashboards, the metrics and a dashboard's cards", async ({
    expect,
  }) => {
    const { run, printed, sent, dashboard } = create();
    await run(dashboard.list, "");
    await run(dashboard.metrics, "");
    await run(dashboard.cards, "--dashboard 1");
    expect(sent).toEqual([
      ["listProjectDashboards", { params: { projectId: 7 } }],
      ["listProjectDashboardMetrics", { params: { projectId: 7 } }],
      [
        "listProjectDashboardCards",
        { params: { projectId: 7 }, query: { dashboardId: 1 } },
      ],
    ]);
    const out = printed.join("\n");
    expect(out).toContain("Main");
    expect(out).toContain("uniqueVisitors");
    expect(out).toContain("needs ship.track");
    expect(out).toContain("computed board");
  });

  it("adds a card scoped to an app by its name, and one on the project by default", async ({
    expect,
  }) => {
    const { run, printed, sent, dashboard } = create();
    await run(dashboard.add, "uniqueVisitors --app docs --section Traffic");
    await run(dashboard.add, "openErrors --size 2");
    expect(sent).toEqual([
      ["listSigils", { params: { projectId: 7 } }],
      [
        "addProjectDashboardCard",
        {
          params: { projectId: 7 },
          query: { dashboardId: undefined },
          body: {
            metric: "uniqueVisitors",
            scope: { kind: "apps", sigilIds: [SIGIL] },
            section: "Traffic",
          },
        },
      ],
      [
        "addProjectDashboardCard",
        {
          params: { projectId: 7 },
          query: { dashboardId: undefined },
          body: { metric: "openErrors", scope: { kind: "projects" }, size: 2 },
        },
      ],
    ]);
    expect(printed.join("\n")).toContain(
      `Added card 3: uniqueVisitors, apps ${SIGIL}`,
    );
  });

  it("updates, reorders and removes cards", async ({ expect }) => {
    const { run, sent, dashboard } = create();
    await run(dashboard.update, '3 --size 2 --filters {"period":"window"}');
    await run(dashboard.reorder, "4,3");
    await run(dashboard.remove, "3");
    expect(sent).toEqual([
      [
        "updateProjectDashboardCard",
        {
          params: { projectId: 7, cardId: 3 },
          body: { filters: { period: "window" }, size: 2 },
        },
      ],
      [
        "reorderProjectDashboardCards",
        {
          params: { projectId: 7 },
          query: { dashboardId: undefined },
          body: { ids: [4, 3] },
        },
      ],
      ["removeProjectDashboardCard", { params: { projectId: 7, cardId: 3 } }],
    ]);
  });

  it("refuses an unknown app, two scopes, bad filters and a bad id before writing", async ({
    expect,
  }) => {
    const { run, sent, dashboard } = create();
    await expect(
      run(dashboard.add, "uniqueVisitors --app nope"),
    ).rejects.toThrow(/No app named nope/);
    await expect(
      run(dashboard.add, "uniqueVisitors --app docs --viewer"),
    ).rejects.toThrow(/not several/);
    await expect(
      run(dashboard.add, "uniqueVisitors --filters nope"),
    ).rejects.toThrow(/JSON object/);
    await expect(run(dashboard.remove, "x")).rejects.toThrow(/whole number/);
    expect(sent.map(([name]) => name)).toEqual(["listSigils"]);
  });
});
