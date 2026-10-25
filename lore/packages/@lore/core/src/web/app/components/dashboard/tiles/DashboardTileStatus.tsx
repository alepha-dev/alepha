import { cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import { DASHBOARD_PILL_CLASS } from "./dashboardTileState.ts";

export interface DashboardTileStatusProps {
  rows: NonNullable<DashboardCardValue["rows"]>;
}

/**
 * A `status` tile: one pill per row, an app copy and its state.
 *
 * The pill's text is the row's `id` (`club/production`), else its badge as
 * the locale names it (a board's synthesized "To do" lane), else its title;
 * its count when it has one; its tone is the state; the meta (a version, a
 * last deploy) is the hover.
 */
const DashboardTileStatus = (props: DashboardTileStatusProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  return (
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
          <span className="truncate">
            {row.id ??
              (row.badge
                ? tr(`dashboard.badge.${row.badge}` as never)
                : row.title)}
          </span>
          {row.value !== undefined && (
            <span className="font-medium tabular-nums">{l(row.value)}</span>
          )}
        </li>
      ))}
    </ul>
  );
};

export default DashboardTileStatus;
