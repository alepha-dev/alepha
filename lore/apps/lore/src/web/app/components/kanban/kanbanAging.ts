import type { DateTimeProvider } from "alepha/datetime";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

/**
 * Days in one column before a card is called stale.
 *
 * Two thresholds rather than a gradient: a halo that deepens continuously
 * reads as decoration, while "getting old" and "stalled" are two states
 * somebody can act on.
 */
export const AGING_WARN_DAYS = 7;
export const AGING_STALE_DAYS = 21;

export type AgingLevel = "fresh" | "aging" | "stale";

/**
 * How long a card has sat where it is.
 *
 * ⚠️ Never `updatedAt`. Any edit resets it, so a card in active discussion
 * would look freshly moved while a genuinely stalled one that got a typo
 * fix would look tended — the exact inversion this feature exists to
 * surface. The clock is the last `moved` history entry, falling back to
 * when the quest was accepted, and finally to when it was created.
 *
 * Only accepted cards age. A card in New has not been started, so time
 * there is backlog depth rather than neglect; a completed one is done.
 */
export class KanbanAging {
  levelOf(quest: QuestResource, dt: DateTimeProvider): AgingLevel {
    if (quest.metadata.status !== "accepted") return "fresh";

    const since = this.enteredAt(quest);
    if (!since) return "fresh";

    const days = dt.now().diff(dt.of(since), "day");
    if (days >= AGING_STALE_DAYS) return "stale";
    if (days >= AGING_WARN_DAYS) return "aging";
    return "fresh";
  }

  /**
   * When the card arrived in its current column, as best the record shows.
   *
   * `moved` entries only started being written with this feature, so an
   * older card falls back to `acceptedAt` — the moment it entered the
   * accepted band at all. That is the honest answer for existing data
   * rather than a fabricated one, and it converges on the exact answer as
   * soon as the card is moved once.
   */
  protected enteredAt(quest: QuestResource): string | undefined {
    const moves = (quest.history ?? []).filter(
      (entry) => entry.action === "moved",
    );
    const last = moves[moves.length - 1];
    return last?.at ?? quest.acceptedAt ?? quest.createdAt;
  }
}
