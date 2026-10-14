import { cn } from "@alepha/ui";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import { DASHBOARD_PILL_CLASS } from "./dashboardTileState.ts";

export interface DashboardTileStatusProps {
  rows: NonNullable<DashboardCardValue["rows"]>;
}

/**
 * A `status` tile: one pill per row, an app copy and its state.
 *
 * The pill's text is the row's `id` (`club/production`) or its title, and
 * its tone is the state; the meta (a version, a last deploy) is the hover.
 */
const DashboardTileStatus = (props: DashboardTileStatusProps) => (
  <ul className="flex flex-wrap gap-1.5" data-testid="tile-status">
    {props.rows.map((row) => (
      <li
        key={row.id ?? row.title}
        data-testid="tile-status-pill"
        data-state={row.state ?? "neutral"}
        title={row.meta}
        className={cn(
          "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2 text-[11.5px]",
          DASHBOARD_PILL_CLASS[row.state ?? "neutral"],
        )}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
        <span className="truncate">{row.id ?? row.title}</span>
      </li>
    ))}
  </ul>
);

export default DashboardTileStatus;
