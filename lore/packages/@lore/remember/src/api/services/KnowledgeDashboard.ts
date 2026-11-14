import { DashboardSlotRegistry } from "@lore/core/api";
import { $inject } from "alepha";

/**
 * Knowledge's part of the computed board (#Q2658): the knowledge slot
 * (pinned folio, then recently edited, then this window's new folios), and
 * the headline's fallback when no Work candidate fills it.
 */
export class KnowledgeDashboard {
  protected readonly slots = $inject(DashboardSlotRegistry);

  constructor() {
    this.slots.register({
      slot: "knowledge",
      rank: 10,
      metric: "pinnedFolio",
      size: 2,
      height: 2,
    });
    this.slots.register({
      slot: "knowledge",
      rank: 20,
      metric: "recentFolios",
      size: 2,
      height: 2,
    });
    this.slots.register({
      slot: "knowledge",
      rank: 30,
      metric: "foliosThisMonth",
      size: 2,
      height: 2,
    });
    // After every Work candidate (ranks 10 to 40), so a Knowledge-only
    // project's headline is its knowledge moving.
    this.slots.register({
      slot: "headline",
      rank: 50,
      metric: "recentFolios",
      size: 2,
      height: 2,
    });
  }
}
