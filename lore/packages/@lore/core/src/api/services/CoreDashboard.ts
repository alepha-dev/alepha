import { $inject } from "alepha";

import { DashboardSlotRegistry } from "./DashboardSlotRegistry.ts";

/**
 * Core's own candidates for the computed board (#Q2656, #Q2659): the
 * "needs you" list every module feeds, and the activity feed. Core metrics,
 * so core registers them; it still names no module's metric here.
 */
export class CoreDashboard {
  protected readonly slots = $inject(DashboardSlotRegistry);

  constructor() {
    // Needs you (#Q2656): the merged list every module feeds, hidden at zero
    // by its own `empty`.
    this.slots.register({
      slot: "needsYou",
      rank: 10,
      metric: "needsYou",
      size: 2,
      height: 2,
    });
    // The feed slot: anything in the window, which the feed's own `empty`
    // already says.
    this.slots.register({
      slot: "feed",
      rank: 10,
      metric: "activityFeed",
      size: 2,
      height: 2,
    });
  }
}
