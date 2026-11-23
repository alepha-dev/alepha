import type { ProjectDashboardController } from "@lore/core/api";
import type { SigilController } from "@lore/ship/api";
import { $inject, AlephaError, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

type Print = (message?: string) => void;

interface Card {
  id: number;
  metric: string;
  scope: { kind: string; sigilIds?: string[] };
  size: number;
  height?: number;
  section?: string;
}

/**
 * `lore dashboard` (#Q4206): a project's dashboards and their cards, on the
 * actions the board's edit mode calls, so `project:read` reads and
 * `project:update` writes. The `dashboard_*` MCP tools are the same actions.
 */
export class DashboardCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<ProjectDashboardController>(
    this.client.scope(),
  );
  protected readonly sigilApi = $client<SigilController>(this.client.scope());

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  protected static readonly DASHBOARD_FLAG = {
    dashboard: z
      .text({
        aliases: ["d"],
        description:
          "The dashboard's id, as lore dashboard list prints it. Defaults to the project's first.",
      })
      .optional(),
  };

  protected static readonly CARD_ARG = z.text({
    title: "card",
    description: "The card's id, as lore dashboard cards prints it.",
  });

  /**
   * What a card shows and where, shared by `add` and `update`.
   */
  protected static readonly CARD_FLAGS = {
    app: z
      .text({
        description:
          "Scope the card to these apps: names or sigil ids, comma-separated.",
      })
      .optional(),
    epic: z
      .text({ description: "Scope the card to one epic, by its row id." })
      .optional(),
    release: z
      .text({ description: "Scope the card to one release, by its row id." })
      .optional(),
    viewer: z
      .boolean()
      .describe("Scope the card to whoever reads the board.")
      .optional(),
    filters: z
      .text({
        description:
          "The metric's filters as a JSON object; lore dashboard metrics gives their schema.",
      })
      .optional(),
    size: z.text({ description: "Columns wide, 1 to 6." }).optional(),
    height: z.text({ description: "Rows high, 1 or 2." }).optional(),
    section: z
      .text({ description: "The heading the card sits under." })
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description: "The project's dashboards, in order",
    flags: z.object({
      ...DashboardCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { dashboards } = await this.api.listProjectDashboards({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, dashboards);
          return;
        }
        this.render.list(
          print,
          dashboards.map((it) => ({
            handle: it.id === undefined ? "-" : String(it.id),
            title: it.name ?? "Dashboard",
            fields: [it.slug ?? "", it.first ? "first" : ""].filter(Boolean),
          })),
          undefined,
          "This project has no dashboard.",
        );
      });
    },
  });

  public readonly metrics = $command({
    name: "metrics",
    description:
      "The metrics a card can show, with the scope kinds each accepts and its default filters",
    flags: z.object({
      ...DashboardCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { metrics } = await this.api.listProjectDashboardMetrics({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, metrics);
          return;
        }
        this.render.list(
          print,
          metrics.map((it) => ({
            handle: it.key,
            title: it.scopeKinds.join(", "),
            fields: [
              JSON.stringify(it.defaultFilters),
              it.needs
                ? `needs ${it.needs.capability}${it.needs.option ? `.${it.needs.option}` : ""}`
                : "",
            ].filter((field) => field && field !== "{}"),
          })),
          undefined,
          "No metric is available.",
        );
      });
    },
  });

  public readonly cards = $command({
    name: "cards",
    description: "A dashboard's stored cards, in grid order",
    flags: z.object({
      ...DashboardCommand.PROJECT_FLAG,
      ...DashboardCommand.DASHBOARD_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { cards } = await this.api.listProjectDashboardCards({
          params: { projectId },
          query: { dashboardId: this.integer(flags.dashboard, "--dashboard") },
        });
        if (flags.output === "json") {
          this.render.json(print, cards);
          return;
        }
        this.render.list(
          print,
          cards.map((card) => this.row(card)),
          undefined,
          "No stored card: the first dashboard shows the computed board until one is added.",
        );
      });
    },
  });

  public readonly add = $command({
    name: "add",
    description:
      "Add a card at the end of a dashboard; the project itself unless --app, --epic, --release or --viewer narrows it",
    args: z.text({
      title: "metric",
      description: "The metric key, as lore dashboard metrics prints it.",
    }),
    flags: z.object({
      ...DashboardCommand.PROJECT_FLAG,
      ...DashboardCommand.DASHBOARD_FLAG,
      ...DashboardCommand.CARD_FLAGS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const layout = this.layout(flags);
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const card = await this.api.addProjectDashboardCard({
          params: { projectId },
          query: { dashboardId: this.integer(flags.dashboard, "--dashboard") },
          body: {
            metric: args,
            scope: (await this.scope(projectId, flags)) ?? {
              kind: "projects",
            },
            ...layout,
          },
        });
        this.show(print, flags.output, card, "Added");
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Change a card's metric, scope, filters, size, height or section; what is not given is left alone",
    args: DashboardCommand.CARD_ARG,
    flags: z.object({
      ...DashboardCommand.PROJECT_FLAG,
      metric: z.text({ description: "A new metric key." }).optional(),
      ...DashboardCommand.CARD_FLAGS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const cardId = this.integer(args, "card")!;
      const layout = this.layout(flags);
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const scope = await this.scope(projectId, flags);
        const card = await this.api.updateProjectDashboardCard({
          params: { projectId, cardId },
          body: {
            ...(flags.metric ? { metric: flags.metric } : {}),
            ...(scope ? { scope } : {}),
            ...layout,
          },
        });
        this.show(print, flags.output, card, "Updated");
      });
    },
  });

  public readonly remove = $command({
    name: "remove",
    description: "Remove one card from its dashboard",
    args: DashboardCommand.CARD_ARG,
    flags: z.object({
      ...DashboardCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const cardId = this.integer(args, "card")!;
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        await this.api.removeProjectDashboardCard({
          params: { projectId, cardId },
        });
        if (flags.output === "json") {
          this.render.json(print, { ok: true });
          return;
        }
        print(`Removed card ${cardId}`);
      });
    },
  });

  public readonly reorder = $command({
    name: "reorder",
    description:
      "Put a dashboard's cards in a new order: every card id, comma-separated, in the order wanted",
    args: z.text({
      title: "ids",
      description: "Every card id of the dashboard, comma-separated.",
    }),
    flags: z.object({
      ...DashboardCommand.PROJECT_FLAG,
      ...DashboardCommand.DASHBOARD_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const ids = args
        .split(",")
        .map((it) => it.trim())
        .filter(Boolean)
        .map((it) => this.integer(it, "ids")!);
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const { cards } = await this.api.reorderProjectDashboardCards({
          params: { projectId },
          query: { dashboardId: this.integer(flags.dashboard, "--dashboard") },
          body: { ids },
        });
        if (flags.output === "json") {
          this.render.json(print, cards);
          return;
        }
        this.render.list(
          print,
          cards.map((card) => this.row(card)),
          undefined,
          "No stored card.",
        );
      });
    },
  });

  public readonly dashboard = $command({
    name: "dashboard",
    description: "A project's dashboards and their cards",
    children: [
      this.list,
      this.metrics,
      this.cards,
      this.add,
      this.update,
      this.remove,
      this.reorder,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The scope the flags name, or undefined when none does. `--app` takes
   * names or sigil ids; a name is looked up among the project's sigils.
   */
  protected async scope(
    projectId: number,
    flags: {
      app?: string;
      epic?: string;
      release?: string;
      viewer?: boolean;
    },
  ) {
    const named = [flags.app, flags.epic, flags.release, flags.viewer].filter(
      (it) => it !== undefined && it !== false,
    );
    if (named.length > 1)
      throw new UsageError(
        "Give one of --app, --epic, --release or --viewer, not several",
      );
    if (flags.viewer) return { kind: "viewer" as const };
    if (flags.epic !== undefined)
      return {
        kind: "epic" as const,
        epicId: this.integer(flags.epic, "--epic"),
      };
    if (flags.release !== undefined)
      return {
        kind: "release" as const,
        releaseId: this.integer(flags.release, "--release"),
      };
    if (flags.app === undefined) return undefined;
    const wanted = flags.app
      .split(",")
      .map((it) => it.trim())
      .filter(Boolean);
    const { items } = await this.sigilApi.listSigils({ params: { projectId } });
    const sigilIds = wanted.map((it) => {
      const sigil = items.find((row) => row.id === it || row.name === it);
      if (!sigil)
        throw new AlephaError(
          `No app named ${it} in this project; lore sigil list prints them`,
        );
      return sigil.id;
    });
    return { kind: "apps" as const, sigilIds };
  }

  /**
   * The filters and layout the flags give, validated before any request.
   */
  protected layout(flags: {
    filters?: string;
    size?: string;
    height?: string;
    section?: string;
  }) {
    let filters: Record<string, unknown> | undefined;
    if (flags.filters !== undefined) {
      try {
        filters = JSON.parse(flags.filters);
      } catch {
        throw new UsageError("--filters is a JSON object");
      }
      if (!filters || typeof filters !== "object" || Array.isArray(filters))
        throw new UsageError("--filters is a JSON object");
    }
    const size = this.integer(flags.size, "--size");
    const height = this.integer(flags.height, "--height");
    return {
      ...(filters ? { filters } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(flags.section !== undefined ? { section: flags.section } : {}),
    };
  }

  protected integer(raw: string | undefined, name: string) {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0)
      throw new UsageError(`${name} is a whole number`);
    return value;
  }

  protected row(card: Card) {
    return {
      handle: String(card.id),
      title: card.metric,
      fields: [
        this.describeScope(card.scope),
        `${card.size}x${card.height ?? 1}`,
        card.section ?? "",
      ].filter(Boolean),
    };
  }

  protected describeScope(scope: Card["scope"]): string {
    if (scope.kind === "apps")
      return `apps ${(scope.sigilIds ?? []).join(",")}`;
    return scope.kind === "projects" ? "project" : scope.kind;
  }

  protected show(print: Print, output: string, card: Card, verb: string) {
    if (output === "json") {
      this.render.json(print, card);
      return;
    }
    print(
      `${verb} card ${card.id}: ${card.metric}, ${this.describeScope(card.scope)}`,
    );
  }
}
