import { TimeAgo } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { HomeActivityRow } from "@/api/schemas/homeActivityRowSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import { activityResourceHref } from "../project/activity/activityResourceHref.ts";
import { homeActivityRef } from "./homeActivityRef.ts";

export interface HomeActivityLineProps {
  row: HomeActivityRow;
  /**
   * The project's slug, for the link. Absent when the viewer's membership of
   * that project ended between the feed being read and this render, in which
   * case the line renders as text.
   */
  projectSlug?: string;
  /**
   * Whether the panel is currently showing one project. When it is, the line
   * drops the project initial: every line carries the same one, and a column
   * of identical badges is noise.
   */
  filtered: boolean;
}

/**
 * One event: who, what they did, and what they did it to.
 *
 * ## The verb is the raw `action`
 *
 * `create`, `complete`, `publish`, `shelve`. Not a sentence like "shelved the
 * quest": the set is open (every `$audit` declaration adds to it, and a new
 * one reaches this panel the day it is written), so a phrase per action would
 * be a translation key that does not exist yet for the newest verb. The
 * project's Activity table prints the same raw verb, so the two read alike.
 */
export const HomeActivityLine = (props: HomeActivityLineProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const reference = homeActivityRef(props.row);
  const href = props.projectSlug
    ? activityResourceHref(props.projectSlug, props.row)
    : undefined;

  return (
    <div className="flex items-baseline gap-2 px-4 py-2 text-sm">
      {!props.filtered && (
        <span
          className="bg-muted text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center self-start rounded text-[10px] font-medium"
          title={props.row.projectTitle}
          aria-hidden
        >
          {props.row.projectTitle.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          {props.row.isMe
            ? tr("home.activity.you")
            : (props.row.actor ?? tr("home.activity.unknown"))}
        </span>{" "}
        <span className="text-muted-foreground">{props.row.action}</span>{" "}
        {reference &&
          (href ? (
            <button
              type="button"
              onClick={() => router.push(href as never)}
              // The row's own snapshot of the title, never a live lookup: a
              // quest renamed after the fact must not rewrite what the feed
              // says happened.
              title={props.row.description}
              className="hover:text-primary font-mono text-xs underline-offset-2 hover:underline"
            >
              {reference}
            </button>
          ) : (
            <span
              className="text-muted-foreground font-mono text-xs"
              title={props.row.description}
            >
              {reference}
            </span>
          ))}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
        <TimeAgo value={props.row.createdAt} />
      </span>
    </div>
  );
};
