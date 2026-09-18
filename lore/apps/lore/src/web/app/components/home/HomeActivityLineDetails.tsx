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

  return (
    <dl className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <dt className="sr-only">{tr("activity.col.who")}</dt>
        <dd className="flex min-w-0 items-center gap-2">
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

      <div className="flex min-w-0 items-center gap-2">
        <dt className="sr-only">{tr("home.table.col.project")}</dt>
        <dd className="text-muted-foreground truncate">{row.projectTitle}</dd>
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
        <dd className="text-muted-foreground/70 font-mono">
          {dt.of(row.createdAt).format("lll")}
          {row.updatedAt && ` → ${dt.of(row.updatedAt).format("lll")}`}
          {(row.eventCount ?? 1) > 1 && ` · ×${row.eventCount}`}
        </dd>
      </div>
    </dl>
  );
};
