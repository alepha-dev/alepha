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

  // A "N more" row closing a merged list (#Q2656): its title is the source's
  // code, and the locale says what there is more of.
  const more = row.badge === "more";

  const content = more ? (
    <span className="text-primary-text text-[12px]">
      {tr("dashboard.more", {
        args: [
          String(row.value ?? 0),
          tr(`dashboard.source.${row.title}` as never),
        ],
      })}
    </span>
  ) : (
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
      {row.at && (props.variant === "feed" || !row.meta) ? (
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

  // A feed row's second line: a completion message, say. Muted, one line.
  const excerpt = row.excerpt && (
    <span
      data-testid="tile-row-excerpt"
      className="text-muted-foreground block w-full truncate pb-0.5 text-left text-[11.5px]"
    >
      {row.excerpt}
    </span>
  );

  if (!link) {
    return (
      <li data-testid="tile-row">
        <div className={className}>{content}</div>
        {excerpt}
      </li>
    );
  }

  return (
    <li data-testid="tile-row">
      <button
        type="button"
        className="hover:bg-muted/60 -mx-1 block w-full rounded px-1"
        onClick={() =>
          void router.push(
            link.route as never,
            { params: link.params, query: link.query } as never,
          )
        }
      >
        <span className={className}>{content}</span>
        {excerpt}
      </button>
    </li>
  );
};

export default DashboardTileRow;
