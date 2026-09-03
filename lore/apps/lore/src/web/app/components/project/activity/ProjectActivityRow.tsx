import { Badge } from "@alepha/ui/components/ui/badge";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { ProjectActivityEvent } from "@/api/schemas/projectActivitySchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { ACTIVITY_ICON } from "./activityEventMeta.ts";

export interface ProjectActivityRowProps {
  event: ProjectActivityEvent;
  projectSlug: string;
}

/**
 * One line of the feed: an icon, who did what, and when.
 *
 * The subject is a link wherever the event names something addressable. A
 * release is the one that can fail to be: `releases.tag` is nullable at the
 * column even though the create schema requires it, so a row with no tag
 * renders as plain text rather than a link to a URL that would not resolve.
 */
const ProjectActivityRow = (props: ProjectActivityRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const event = props.event;
  const Icon = ACTIVITY_ICON[event.kind];

  const subject = () => {
    if (event.quest) {
      return (
        <Link
          className="hover:underline"
          href={router.path("projectQuest", {
            params: {
              projectSlug: props.projectSlug,
              shortId: event.quest.shortId,
            },
          })}
        >
          {event.quest.title}
        </Link>
      );
    }
    if (event.epic) {
      return (
        <Link
          className="hover:underline"
          href={router.path("projectEpic", {
            params: {
              projectSlug: props.projectSlug,
              epicNumber: event.epic.number,
            },
          })}
        >
          {event.epic.title}
        </Link>
      );
    }
    if (event.folio) {
      return (
        <Link
          className="hover:underline"
          href={router.path("projectFoliosFolio", {
            params: {
              projectSlug: props.projectSlug,
              shortId: event.folio.shortId,
            },
          })}
        >
          {event.folio.title}
        </Link>
      );
    }
    if (event.release) {
      // No tag means no URL segment, so this one stays text.
      return event.release.tag ? (
        <Link
          className="hover:underline"
          href={router.path("projectRelease", {
            params: {
              projectSlug: props.projectSlug,
              releaseTag: event.release.tag,
            },
          })}
        >
          {event.release.title}
        </Link>
      ) : (
        <span>{event.release.title}</span>
      );
    }
    if (event.feedback) {
      // Feedback has no per-item route — the inbox is the only surface —
      // so the title is text and the row's link goes nowhere.
      return <span>{event.feedback.title}</span>;
    }
    return null;
  };

  return (
    <div className="flex items-start gap-3 border-t py-2.5 first:border-t-0">
      <Icon
        aria-hidden="true"
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm leading-snug">
          <span className="font-medium">
            {event.actor ?? tr("activity.actor.unknown")}
          </span>{" "}
          <span className="text-muted-foreground">{event.summary}</span>{" "}
          {subject()}
        </div>
      </div>
      {event.actorKind === "agent" ? (
        <Badge tone="info" variant="outline">
          {tr("activity.actor.agent")}
        </Badge>
      ) : null}
      <span
        className="text-muted-foreground shrink-0 text-xs"
        title={String(dt.of(event.at).format("lll"))}
      >
        {dt.of(event.at).fromNow()}
      </span>
    </div>
  );
};

export default ProjectActivityRow;
