import { $inject, AlephaError } from "alepha";
import type { UserAccountToken } from "alepha/security";

import type { Project } from "../entities/projects.ts";
import type { DashboardCardResource } from "../schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import type { DashboardScope } from "../schemas/dashboardScopeSchema.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";

/**
 * The slots of the computed board, in the order they render (folio #F1364).
 */
export type DashboardSlot =
  | "headline"
  | "needsYou"
  | "yourWork"
  | "flow"
  | "plan"
  | "apps"
  | "knowledge"
  | "feed"
  /**
   * The only slot of a DORMANT project's board (#Q2662): what it shipped
   * last, under the "quiet since" line, instead of a page of slots that
   * would all collapse.
   */
  | "dormant";

/**
 * One tile a module offers to a slot of the computed board.
 */
export interface DashboardSlotCandidate {
  slot: DashboardSlot;
  /**
   * Order inside the slot, ascending: the first candidate that passes both
   * gates fills it.
   */
  rank: number;
  metric: string;
  filters?: Record<string, unknown>;
  /**
   * What the tile points at. Absent, the project itself, as a project-board
   * card that was never asked would be stored.
   */
  scope?: (project: Project) => DashboardScope;
  size?: number;
  height?: number;
  /**
   * The SLOT's own data gate, on top of the metric's `empty`: "needs you is
   * hidden at zero", "flow needs five completions in the window". A rule
   * about where the tile sits rather than about the metric, so a customized
   * board showing the same metric is not bound by it.
   */
  keep?: (value: DashboardCardValue) => boolean;
}

/**
 * What one load of the computed board produced.
 */
export interface ComputedDashboard {
  cards: DashboardCardResource[];
  values: DashboardCardValue[];
}

/**
 * The default board of a project with no stored cards, computed on every load
 * and never written (#E77, #Q2652, folio #F1364).
 *
 * ## Slots, filled by modules, naming no module
 *
 * Core declares the slots and their order. Each module registers candidate
 * tiles into them with a rank, the way it registers metrics; core never names
 * a metric of its own here.
 *
 * ## Two gates
 *
 * A candidate is OFFERED when its metric's `needs` pass for the project (the
 * capability gate, `DashboardMetricRegistry.answers`), and KEPT when its value
 * is not `empty` and not failed, and passes the slot's own `keep` (the data
 * gate). The first kept candidate fills its slot; a slot nobody fills
 * disappears and the layout closes up.
 *
 * ## One request, resolved in rank waves
 *
 * ⚠️ The board is ONE request, and each wave is ONE grouped pass of
 * `DashboardMetricRegistry` (folio #1057), never a request or a resolve per
 * slot. A wave resolves the best remaining candidate of every slot still
 * undecided, so a candidate that loses to a better-ranked one is never
 * resolved (#Q3493, folio #F1411). That was the ONE resolve of every offered
 * candidate until 2026-11-12: on D1 every query is a round trip, and the
 * losing candidates were thirteen of a board's fifty-two.
 *
 * ## Nothing is written
 *
 * A capability switched on or off changes the board on the next load, with
 * nothing to migrate. "Customize" is what copies the tiles into storage.
 */
export class DashboardSlotRegistry {
  protected readonly metrics = $inject(DashboardMetricRegistry);
  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly candidates: DashboardSlotCandidate[] = [];

  /**
   * The slot order, which is the board's reading order.
   */
  readonly slots: DashboardSlot[] = [
    "headline",
    "needsYou",
    "yourWork",
    "flow",
    "plan",
    "apps",
    "knowledge",
    "feed",
  ];

  /**
   * Offer a tile to a slot. A metric may sit in several slots, once each.
   */
  register(candidate: DashboardSlotCandidate): void {
    if (
      this.candidates.some(
        (it) => it.slot === candidate.slot && it.metric === candidate.metric,
      )
    ) {
      throw new AlephaError(
        `Dashboard slot '${candidate.slot}' already offers '${candidate.metric}'`,
      );
    }
    this.candidates.push(candidate);
  }

  /**
   * Every candidate of one slot, best first.
   */
  of(slot: DashboardSlot): DashboardSlotCandidate[] {
    return this.candidates
      .filter((it) => it.slot === slot)
      .sort((a, b) => a.rank - b.rank);
  }

  /**
   * Compute one project's board for one reader.
   */
  async compute(
    project: Project,
    user: UserAccountToken,
    windowDays: number = DashboardMetricRegistry.DEFAULT_WINDOW_DAYS,
    options: { dormant?: boolean } = {},
  ): Promise<ComputedDashboard> {
    const capabilities = await this.metrics.capabilitiesOf([project.id]);
    const slots: DashboardSlot[] = options.dormant ? ["dormant"] : this.slots;

    // The capability gate, per candidate. Synthetic ids are negative so they
    // can never be mistaken for a stored card's.
    const offered: Array<{
      candidate: DashboardSlotCandidate;
      card: DashboardCardResource;
    }> = [];
    for (const slot of slots) {
      for (const candidate of this.of(slot)) {
        const descriptor = this.catalog.find(candidate.metric);
        if (!descriptor || !this.catalog.offers(candidate.metric, "project")) {
          continue;
        }
        if (!this.metrics.answers(descriptor, project.id, capabilities)) {
          continue;
        }
        offered.push({
          candidate,
          card: {
            id: -(offered.length + 1),
            metric: candidate.metric,
            scope: candidate.scope?.(project) ??
              this.catalog.forcedScope(
                candidate.metric,
                "project",
                project.id,
              ) ?? { kind: "projects", projectIds: [project.id] },
            filters: this.catalog.parseFilters(
              candidate.metric,
              candidate.filters ?? {},
            ),
            size: candidate.size ?? 1,
            height: candidate.height ?? 1,
            position: 0,
            slot,
          },
        });
      }
    }

    // Rank waves (#Q3493): resolve only what the data gate still needs to
    // see, until every slot is decided. Each wave is one grouped resolve.
    const valueOf = new Map<number, DashboardCardValue>();
    for (;;) {
      const { needed } = this.select(slots, offered, valueOf);
      if (needed.length === 0) break;
      const values = await this.metrics.resolveForProject(
        needed.map((it) => it.card),
        user,
        project,
        capabilities,
        windowDays,
      );
      for (const value of values) valueOf.set(value.cardId, value);
      // A resolve that answered nothing for a card would loop forever:
      // record it as failed, which the data gate drops.
      for (const it of needed) {
        if (!valueOf.has(it.card.id)) {
          valueOf.set(it.card.id, {
            cardId: it.card.id,
            ok: false,
            detail: {},
            scopeNames: [],
          } as DashboardCardValue);
        }
      }
    }

    const { winners } = this.select(slots, offered, valueOf);
    const cards: DashboardCardResource[] = [];
    const kept: DashboardCardValue[] = [];
    for (const winner of winners) {
      cards.push({ ...winner.card, position: cards.length });
      kept.push(valueOf.get(winner.card.id)!);
    }
    return { cards, values: kept };
  }

  /**
   * The data gate over what is resolved so far: the first candidate per slot
   * whose value is kept, a metric that already filled an earlier slot not
   * drawn twice ("releases to publish" is a headline candidate AND a plan
   * candidate).
   *
   * ## Waves (#Q3493)
   *
   * Each slot walks its candidates best first, as it always did, and stops
   * at the first one not resolved yet: that one is `needed`, and resolving
   * it is what moves the slot on. Every pass starts from scratch in slot
   * order and commits nothing, so a later slot that briefly holds a metric
   * an earlier slot ends up taking simply walks on in the next pass.
   *
   * The pass that needs nothing walked every slot over resolved values only,
   * which is exactly what resolving every candidate at once and then walking
   * would have done: the board is the same, and the candidates that lose to
   * a better-ranked one are never resolved.
   */
  protected select(
    slots: DashboardSlot[],
    offered: Array<{
      candidate: DashboardSlotCandidate;
      card: DashboardCardResource;
    }>,
    valueOf: Map<number, DashboardCardValue>,
  ) {
    const winners: Array<{
      candidate: DashboardSlotCandidate;
      card: DashboardCardResource;
    }> = [];
    const needed: typeof winners = [];
    const shown = new Set<string>();

    for (const slot of slots) {
      for (const it of offered.filter((o) => o.candidate.slot === slot)) {
        if (shown.has(it.candidate.metric)) continue;
        const value = valueOf.get(it.card.id);
        if (!value) {
          needed.push(it);
          break;
        }
        if (!value.ok || value.empty) continue;
        if (it.candidate.keep && !it.candidate.keep(value)) continue;
        winners.push(it);
        shown.add(it.candidate.metric);
        break;
      }
    }

    return { winners, needed };
  }
}
