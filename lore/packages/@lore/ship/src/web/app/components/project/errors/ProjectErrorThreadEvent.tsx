import { cn, textLinkUnderlineClassName, TimeAgo } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import {
  Activity,
  CheckCircle2,
  type LucideIcon,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldOff,
  Sparkles,
} from "lucide-react";

import type { ProjectErrorTimelineEntry } from "./projectErrorThreadEntries.ts";

export interface ProjectErrorThreadEventProps {
  entry: Extract<ProjectErrorTimelineEntry, { type: "event" }>;
  /**
   * Where a quest lives, for a forward or a link whose quest the caller is
   * shown.
   */
  questHref: (shortId: number) => string;
}

const ICONS: Record<
  Extract<ProjectErrorTimelineEntry, { type: "event" }>["kind"],
  LucideIcon
> = {
  first_reported: Sparkles,
  trusted_on_arrival: ShieldCheck,
  trusted: ShieldCheck,
  untrusted: ShieldOff,
  resolved: CheckCircle2,
  forwarded: Send,
  linked: Send,
  handed_back: RotateCcw,
  run_resolved: CheckCircle2,
  run_reopened: RotateCcw,
  monitor_resolved: Activity,
  monitor_reopened: Activity,
};

/**
 * The changes only a member makes. One of them with no member left on it is
 * a deleted account's: the foreign key cleared the actor.
 */
const MEMBER_KINDS: ReadonlySet<string> = new Set([
  "trusted",
  "untrusted",
  "resolved",
  "forwarded",
  "linked",
]);

/**
 * One change of an error's triage state, on one line: a glyph in the feed's
 * gutter, who did it, what, and when. A change nobody made (a passing run, a
 * monitor's recovery, a deleted quest) is Lore's, and says so.
 *
 * It names a member, a kind and a quest, and nothing of the error's own
 * text: an event stores none.
 */
const ProjectErrorThreadEvent = (props: ProjectErrorThreadEventProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { kind, at, entry } = props.entry;
  const Icon = ICONS[kind];
  // A member's verb with no member or no name left is a deleted account's;
  // any other event with no member is Lore's own, and its sentence says so.
  const who = entry?.userName
    ? entry.userName
    : entry?.userId || MEMBER_KINDS.has(kind)
      ? tr("errors.thread.formerMember")
      : undefined;
  const quest = entry?.quest;

  return (
    <li
      className="flex gap-3 py-3"
      data-testid="error-thread-event"
      data-kind={kind}
    >
      <span className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border">
        <Icon className="size-3.5" />
      </span>
      <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 text-sm">
        <span className="min-w-0">
          {who && <span className="font-medium">{who} </span>}
          <span className="text-muted-foreground">
            {tr(`errors.thread.event.${kind}`)}
          </span>
          {quest?.shortId !== undefined && (
            <>
              {" "}
              <Link
                href={props.questHref(quest.shortId)}
                className={cn(
                  textLinkUnderlineClassName,
                  "hover:text-foreground",
                )}
              >
                {formatReference("quest", quest.shortId)}
              </Link>
            </>
          )}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
          <TimeAgo value={at} />
        </span>
      </div>
    </li>
  );
};

export default ProjectErrorThreadEvent;
