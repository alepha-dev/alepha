import { cn } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../services/I18n.ts";
import { activityAgeInDays } from "./homeActivityAge.ts";

export interface HomeLastActivityProps {
  /**
   * When the project last saw any activity, from `getHomeBoard`. Absent
   * until the board has been read, when the cell stays empty.
   */
  at?: string;
  /**
   * Whether the project has gone quiet (`HOME_INACTIVE_AFTER_DAYS`), which
   * mutes the cell.
   */
  inactive: boolean;
}

/**
 * The Home table's Last activity cell: "today", or how many days ago with
 * the date under it ("3d ago", "15 Sep").
 *
 * Days rather than `fromNow`'s wording ("a month ago"), because the column
 * is compared row against row, and "a month ago" beside "a month ago" hides
 * the difference between 32 days and 58. The date under it answers "when"
 * without a hover.
 */
export const HomeLastActivity = (props: HomeLastActivityProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  if (!props.at) return null;

  const days = activityAgeInDays(dt, props.at);
  return (
    <div
      className={cn(
        "flex flex-col text-sm whitespace-nowrap",
        props.inactive ? "text-muted-foreground" : "font-medium",
      )}
      title={String(dt.of(props.at).format("lll"))}
    >
      <span>
        {days <= 0
          ? tr("home.table.lastActivity.today")
          : tr("home.table.lastActivity.daysAgo", { args: [l(days)] })}
      </span>
      {days > 0 && (
        <span
          className={cn(
            "text-xs font-normal",
            props.inactive
              ? "text-muted-foreground/70"
              : "text-muted-foreground",
          )}
        >
          {l(props.at, { date: "D MMM" })}
        </span>
      )}
    </div>
  );
};
