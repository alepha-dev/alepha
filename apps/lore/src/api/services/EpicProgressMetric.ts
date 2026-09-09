import { $inject } from "alepha";

import type { Epic } from "../entities/epics.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { EpicProgressService } from "./EpicProgressService.ts";

/**
 * How far along one epic is, as a percentage.
 *
 * ## The rollup is reused, never recomputed
 *
 * The buckets come from `EpicProgressService.computeProgressOf`, which is the
 * same method the Epics list, `epic_list`, `project_context` and MCP output
 * read. A second definition of "done" that disagrees with the Epics list by
 * one is worse than no card at all.
 *
 * ## ⚠️ The denominator, and why it is subtracted HERE
 *
 * The card shows `completed / (total - shelved)`, ruled by the owner on
 * 2026-09-09 (A3 of epic #E46). The subtraction happens at the card and not
 * at the source, because `computeProgressOf` sets `total` to every quest of
 * the epic INCLUDING the shelved ones, and four other surfaces read it:
 * changing its denominator would move all of them, which is a bigger decision
 * than this epic.
 *
 * ⚠️ Note the asymmetry, which is what makes this easy to get wrong twice:
 * `ReleaseContentService.progressOf` ALREADY counts shelved outside its
 * `total`, so on the release card the same subtraction is a no-op and must
 * not be applied. Read both comments before touching either card's
 * arithmetic.
 *
 * The consequence is that this percentage is not derivable by eye from the
 * Epics list's tick bar, which draws all four buckets over `total`. So the
 * card says what it divides by, in its footer, and the docs page says it
 * again. A number two surfaces disagree about with nothing on screen
 * explaining why is the exact failure the reuse rule exists to avoid.
 *
 * ## A concluded epic
 *
 * The card stays and says so (D3 of the epic). An epic's status is a one-way
 * ratchet and `done` is terminal, so the number is settled rather than stale.
 * Repointing is the Edit item the card menu already has: no auto-repoint and
 * no self-deletion, because a card is somebody's configuration and a board
 * that quietly rewrites itself is worse than one that goes visibly stale.
 */
export class EpicProgressMetric implements DashboardMetricResolver {
  readonly metric = "epicProgress";

  protected readonly progress = $inject(EpicProgressService);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  /**
   * ONE batched rollup for every epic card on the board, which is what
   * `computeProgressOf` was written to be.
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

    // A card whose epic dropped out of `narrow()` - its project turned
    // `work.epics` off - has no epic here and never reaches the query.
    const epics = cards
      .map((entry) => entry.scope.epic)
      .filter((epic): epic is Epic => !!epic);

    const buckets = await this.progress.computeProgressOf([
      ...new Set(epics.map((epic) => epic.id)),
    ]);

    for (const entry of cards) {
      const epic = entry.scope.epic;
      if (!epic) {
        // Zero rather than unreadable: the project genuinely has no Epics
        // surface any more, the same answer every other metric gives when
        // narrowing empties its scope.
        out.set(entry.card.id, { detail: { hidden: true } });
        continue;
      }

      const progress = buckets.get(epic.id) ?? {
        completed: 0,
        inProgress: 0,
        shelved: 0,
        total: 0,
      };

      // ⚠️ The subtraction, once, here. See the class doc.
      const denominator = progress.total - progress.shelved;
      const open = Math.max(
        0,
        progress.total -
          progress.completed -
          progress.inProgress -
          progress.shelved,
      );

      out.set(entry.card.id, {
        // An epic with nothing to count, or one whose every quest is shelved,
        // divides by zero. `undefined` renders as the card's no-value glyph
        // rather than as `NaN`, `Infinity` or a misleading 0%.
        value:
          denominator > 0
            ? Math.round((progress.completed / denominator) * 100)
            : undefined,
        detail: {
          completed: progress.completed,
          inProgress: progress.inProgress,
          shelved: progress.shelved,
          total: progress.total,
          open,
          // What the percentage was divided by, so the footer can say it
          // rather than the reader having to work it out from four buckets.
          denominator,
          status: epic.status,
          completedAt: epic.completedAt ?? null,
        },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: entry.scope.projects[0]?.slug,
          // ⚠️ The per-project NUMBER, which is what `/epics/:epicNumber`
          // takes. The scope stores the row id, and a card that put one where
          // the page expects the other would land on somebody else's epic
          // without erroring.
          epicNumber: epic.number,
        }),
      });
    }

    return out;
  }
}
