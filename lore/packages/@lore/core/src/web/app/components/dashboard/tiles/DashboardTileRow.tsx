import { cn } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { ClientOnly, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import {
  DASHBOARD_FILL_CLASS,
  DASHBOARD_PILL_CLASS,
} from "./dashboardTileState.ts";

export interface DashboardTileRowProps {
  row: NonNullable<DashboardCardValue["rows"]>[number];
  /**
   * `feed` puts a relative time where `list` puts its meta.
   */
  variant: "list" | "feed";
}

/**
 * One row of a `list` or `feed` tile.
 *
 * The typed reference first as a chip, the title truncated inside its own
 * container (so a long one never pushes the meta off the tile), the meta or
 * the time right-aligned, and the badge as a state pill. A row with a link
 * is a button; the tile around it is then not one, since a button cannot
 * hold a button.
 *
 * The relative time is `ClientOnly` for the reason `ProjectDashboardHeader`
 * gives: `fromNow()` differs between the server render and hydration.
 */
const DashboardTileRow = (props: DashboardTileRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const dateTime = useInject(DateTimeProvider);
  const row = props.row;
  const link = row.link;

  const content = (
    <>
      {row.id && (
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 font-mono text-[10.5px] leading-4">
          {row.id}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{row.title}</span>
      {row.badge && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 text-[10.5px] leading-4",
            DASHBOARD_PILL_CLASS[row.state ?? "neutral"],
          )}
        >
          {tr(`dashboard.badge.${row.badge}` as never)}
        </span>
      )}
      {row.progress !== undefined && (
        <span className="bg-muted relative h-1.5 w-10 shrink-0 overflow-hidden rounded-full">
          <span
            className={cn(
              "absolute inset-y-0 left-0",
              DASHBOARD_FILL_CLASS[row.state ?? "accent"],
            )}
            style={{ width: `${row.progress}%` }}
          />
        </span>
      )}
      {props.variant === "feed" && row.at ? (
        <span className="text-muted-foreground shrink-0 text-[11px]">
          <ClientOnly>{dateTime.of(row.at).fromNow()}</ClientOnly>
        </span>
      ) : (
        row.meta && (
          <span className="text-muted-foreground max-w-24 shrink-0 truncate text-[11px]">
            {row.meta}
          </span>
        )
      )}
    </>
  );

  const className =
    "flex w-full min-w-0 items-center gap-1.5 py-[3px] text-left";

  if (!link) {
    return (
      <li data-testid="tile-row" className={className}>
        {content}
      </li>
    );
  }

  return (
    <li data-testid="tile-row">
      <button
        type="button"
        className={cn(className, "hover:bg-muted/60 -mx-1 rounded px-1")}
        onClick={() =>
          void router.push(
            link.route as never,
            { params: link.params, query: link.query } as never,
          )
        }
      >
        {content}
      </button>
    </li>
  );
};

export default DashboardTileRow;
