import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import type { Project } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { OpenQuestScope } from "./OpenQuestScope.ts";

/**
 * How much of the open work is parked: quests with `heldAt` set.
 *
 * ## It is a SUBSET of Active quests, and that is load-bearing
 *
 * ⚠️ The where-shape comes from `OpenQuestScope`, the same service the Active
 * Quests tile, the sidebar badge and the dashboard rail count through. That
 * service excludes completed and shelved quests and applies the draft-epic
 * backlog gate, so quests parked inside a draft epic are out of both
 * numbers. Counting held quests without it would put a figure on the board
 * larger than the card beside it can account for, and "Quests 12 / On hold 3"
 * only reads as "three of the twelve are stuck" while that containment holds.
 *
 * ## It writes its own resolver, and it has to
 *
 * #Q2082 shipped a sidebar entry with a held count on `countOpenQuests` and
 * it was reverted the same day (`bcbf2c06b`), taking that number with it.
 * What survives from it and is now load-bearing is `boardFiltersSchema.status`
 * being derived from `questStatusSchema`, which is the only reason the card's
 * `?status=held` link decodes at all rather than degrading to the whole list.
 *
 * ## "On hold", never "Waiting on you"
 *
 * A hold has no direction: nothing records who is being waited on, and naming
 * a person the data cannot name is a promise the card would not keep. The
 * mention-based and `heldFor` options are additive later, not alternatives.
 */
export class HeldQuestsMetric implements DashboardMetricResolver {
  readonly metric = "heldQuests";

  protected readonly quests = $repository(quests);
  protected readonly openQuests = $inject(OpenQuestScope);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  /**
   * ONE statement for every card on this metric, partitioned in memory.
   *
   * The same shape `ActiveQuestsMetric` uses, and for the same reason: a
   * board with two of these cards must not cost two round trips. The backlog
   * gate survives the union because an epic belongs to exactly one project,
   * so the union's draft set is the union of each project's own.
   */
  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();

    // `inArray: []` throws, so a board whose every card narrowed to an empty
    // scope must not reach the query. Each card still answers zero below.
    const union = [
      ...new Set(cards.flatMap((entry) => entry.scope.projectIds)),
    ];

    // The OPEN rows, held and not, because the footer says what the number is
    // made of and that needs the denominator this card is a subset of.
    const rows = union.length
      ? await this.quests.findMany({
          where: await this.openQuests.where(union),
          columns: ["projectId", "heldAt"],
        })
      : [];

    for (const entry of cards) {
      out.set(entry.card.id, this.resolveOne(entry, rows));
    }

    return out;
  }

  protected resolveOne(
    entry: DashboardResolvable,
    rows: Array<{ projectId: number; heldAt?: string }>,
  ): Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames"> {
    const projectIds = entry.scope.projectIds;

    if (projectIds.length === 0) {
      return { value: 0, detail: { open: 0 } };
    }

    const scoped = new Set(projectIds);
    const open = rows.filter((row) => scoped.has(row.projectId));
    const held = open.filter((row) => row.heldAt != null);

    return {
      value: held.length,
      // `open` is the number the Active Quests card shows, so the footer can
      // say "3 of 12 open quests" and a reader can check the containment for
      // themselves rather than being asked to trust it.
      detail: { open: open.length },
      link: this.catalog.get(this.metric).link(entry.card.scope, {
        projectSlug: this.projectOf(entry.scope.projects)?.slug,
      }),
    };
  }

  /**
   * The project the drill-through opens.
   *
   * A project-board card names exactly one, forced by the controller, so
   * there is no "busiest project" choice to make here.
   */
  protected projectOf(projects: Project[]): Project | undefined {
    return projects[0];
  }
}
