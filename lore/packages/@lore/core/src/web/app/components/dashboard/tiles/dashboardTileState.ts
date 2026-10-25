import type { DashboardTileState } from "../../../../../api/schemas/dashboardTileStateSchema.ts";

/**
 * A pill's colours, per state: a tint of the state's token behind its text
 * colour, so every pill reads in both themes without a dark variant of its
 * own. Read from the kit's tokens, never restated.
 */
export const DASHBOARD_PILL_CLASS: Record<DashboardTileState, string> = {
  ok: "bg-success/15 text-success-text",
  warn: "bg-warning/15 text-warning-text",
  bad: "bg-danger/15 text-danger-text",
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-primary/15 text-primary-text",
};

/**
 * A segment's or a row bar's fill, per state. `neutral` is the track colour
 * one step up, which is what "still to do" looks like on a progress bar.
 */
export const DASHBOARD_FILL_CLASS: Record<DashboardTileState, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-danger",
  neutral: "bg-muted-foreground/35",
  accent: "bg-primary",
};
