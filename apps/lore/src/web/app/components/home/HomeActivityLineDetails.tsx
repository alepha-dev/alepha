import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { User } from "lucide-react";

import type { HomeActivityRow } from "@/api/schemas/homeActivityRowSchema.ts";

import type { I18n } from "../../services/I18n.ts";
import { ActivityDetails } from "../project/activity/ActivityDetails.tsx";
import { activityResourceLabel } from "../project/activity/activityResourceLabel.ts";
import { homeActivityRef } from "./homeActivityRef.ts";

export interface HomeActivityLineDetailsProps {
  row: HomeActivityRow;
}

/**
 * The rest of an event, shown when its line is expanded: who, on what, where,
 * what changed and exactly when.
 *
 * Laid out like a Folio History revision (`FolioHistoryTab`'s
 * `RevisionSummary`): a short list of facts with visually hidden labels, since
 * each value already says what it is.
 */
export const HomeActivityLineDetails = (
  props: HomeActivityLineDetailsProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const row = props.row;
  const reference = homeActivityRef(row);
  const resource = [activityResourceLabel(tr, row.type), reference]
    .filter(Boolean)
    .join(" ");

  /*
   * A compact stamp: `lll` spelled out "Sep 19, 2026 5:12 PM → Sep 19, 2026
   * 5:12 PM", two thirds of which was the same day written twice and a year
   * every reader already knows.
   *
   * The year appears only when the event is not from this one, and the end
   * of a coalesced burst drops the date when it landed on the day it
   * started - which is nearly always, since a burst is minutes wide.
   * Compared by the formatted day rather than by a `isSame` call, so the
   * comparison reads in the reader's own timezone like everything else here.
   */
  const at = dt.of(row.createdAt);
  const dayOf = (value: ReturnType<typeof dt.of>) => value.format("YYYY-MM-DD");
  const full = (value: ReturnType<typeof dt.of>) =>
    value.format(
      dayOf(value).slice(0, 4) === dayOf(dt.now()).slice(0, 4)
        ? "D MMM, HH:mm"
        : "D MMM YYYY, HH:mm",
    );
  const stamp = full(at);
  const end = row.updatedAt ? dt.of(row.updatedAt) : undefined;
  const endStamp = end
    ? dayOf(end) === dayOf(at)
      ? end.format("HH:mm")
      : full(end)
    : undefined;

  return (
    <dl className="flex flex-col gap-2 text-xs">
      {/* Who on the left, WHERE on the right, one line: the project is the
          fact that places every other one, and on a line of its own lower
          down it read as another property of the event. `justify-between`
          rather than a spacer, and the name truncates before the actor's
          does. */}
      <div className="flex items-center justify-between gap-3">
        <dt className="sr-only">{tr("activity.col.who")}</dt>
        <dd className="flex min-w-0 flex-1 items-center gap-2">
          {row.actorAvatarUrl ? (
            <img
              src={row.actorAvatarUrl}
              alt=""
              className="size-5 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full">
              <User className="size-3" />
            </span>
          )}
          <span className="truncate font-medium">
            {row.actor ?? tr("home.activity.unknown")}
          </span>
        </dd>
        <dt className="sr-only">{tr("home.table.col.project")}</dt>
        <dd className="text-muted-foreground max-w-[45%] truncate">
          {row.projectTitle}
        </dd>
      </div>

      <div className="flex min-w-0 items-start gap-2">
        <dt className="sr-only">{tr("activity.col.resource")}</dt>
        <dd className="min-w-0">
          <span className="text-muted-foreground">{resource}</span>
          {/* The row's own snapshot of the title, never a live lookup: a
              quest renamed after the fact must not rewrite what the feed
              says happened. */}
          {row.description && (
            <span className="text-foreground"> {row.description}</span>
          )}
        </dd>
      </div>

      {/* The two shapes `ActivityDetails` knows how to say. Anything else
          renders nothing, and an empty labelled row is worse than none. */}
      {(typeof row.metadata?.capability === "string" ||
        (Array.isArray(row.metadata?.fields) &&
          row.metadata.fields.length > 0)) && (
        <div className="flex min-w-0 items-center gap-2">
          <dt className="sr-only">{tr("activity.col.details")}</dt>
          <dd className="min-w-0">
            <ActivityDetails metadata={row.metadata} />
          </dd>
        </div>
      )}

      <div className="flex items-center gap-2">
        <dt className="sr-only">{tr("activity.col.when")}</dt>
        {/* A coalesced row names its span, and how many events it folded:
            the relative time on the line is only the first of them. */}
        {/* Smaller than the rest: a timestamp is the last thing read and
            the longest string here, and at the list's own size it competed
            with what actually happened. */}
        <dd className="text-muted-foreground/70 font-mono text-[11px]">
          {stamp}
          {endStamp && ` → ${endStamp}`}
          {(row.eventCount ?? 1) > 1 && ` · ×${row.eventCount}`}
        </dd>
      </div>
    </dl>
  );
};
