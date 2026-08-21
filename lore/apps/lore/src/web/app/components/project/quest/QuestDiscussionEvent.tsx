import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  CheckSquare,
  type LucideIcon,
  Pencil,
  Signature,
  SquareSlash,
  Sunrise,
  Swords,
  UserMinus,
} from "lucide-react";

import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import LoreViewer from "../../shared/element/LoreViewer.tsx";
import type { ProjectUser } from "../../shared/useProjectUsers.ts";
import type { QuestDiscussionEntry } from "./questDiscussionEntries.ts";

export interface QuestDiscussionEventProps {
  entry: Extract<QuestDiscussionEntry, { kind: "event" }>;
  users: ProjectUser[];
}

/**
 * One system event in the Discussion, in the feed's two-column shape: a
 * round glyph in the gutter, then actor, a plain-text predicate and the
 * relative time right-aligned.
 *
 * The gutter carries the ICON, not the actor's avatar. A comment puts a face
 * there and an event puts the thing that happened, so the two are told apart
 * from the gutter alone, before any text is read. Showing both, as this did,
 * made every row start with a face and left the icon as decoration.
 *
 * The predicates go through `tr()`. The timeline this replaces hardcoded
 * English RPG titles ("Courageous Choice", "A New Dawn") that shipped
 * untranslated even in FR, and said "by **You**" for every actor regardless
 * of who acted.
 */
const QuestDiscussionEvent = (props: QuestDiscussionEventProps) => {
  const { entry } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);

  const user = entry.by
    ? props.users.find((u) => u.id === entry.by)
    : undefined;
  const actor = entry.by
    ? displayName(user, entry.by)
    : tr("quest.discussion.author.unknown");

  const Icon = ICONS[entry.action] ?? Pencil;

  return (
    <li className="flex gap-3 py-3">
      <span className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border">
        <Icon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* `min-h-7` matches the circle and `items-center` centres against
            it, so the actor line sits on the circle's midline rather than on
            its text baseline. A baseline sits the text high, which reads as
            misaligned the moment the glyph beside it is round. */}
        <div className="flex min-h-7 items-center gap-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{actor}</span>{" "}
            <span className="text-muted-foreground">
              {predicate(tr, entry)}
            </span>
          </span>
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {entry.bodyEdited && (
              <span className="mr-1 italic">
                {tr("quest.discussion.edited")}
              </span>
            )}
            {dt.of(entry.at).fromNow()}
          </span>
        </div>

        {/* Above the summary, because a reader deciding whether to trust a
            closed quest needs to know what was skipped before reading the
            account of what was done. */}
        {!!entry.waivers?.length && (
          <ul className="flex flex-col gap-1">
            {entry.waivers.map((waiver) => (
              <li
                key={waiver.title}
                className="text-muted-foreground flex gap-2 text-xs"
              >
                <SquareSlash className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="text-foreground font-medium">
                    {tr("quest.discussion.waived", { args: [waiver.title] })}
                  </span>{" "}
                  {waiver.reason}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* An event with a body reads as a comment, because that is what it
            is: the completion summary is what the person said as they closed
            the quest. Same bubble as a comment so the feed has one shape for
            "somebody wrote this". */}
        {entry.body && (
          <div className="border-border bg-muted/40 rounded-md border px-3 py-3">
            <LoreViewer
              element={{
                kind: "quest",
                projectId: project?.id ?? 0,
                projectSlug: project?.slug ?? "",
                id: entry.questId ?? 0,
              }}
              content={entry.body}
            />
          </div>
        )}
      </div>
    </li>
  );
};

type Tr = ReturnType<typeof useI18n<I18n, "en">>["tr"];

/**
 * The plain-text half of the row. Two events say more than their action
 * name: a quest promoted from feedback names the item it came from, and a
 * completed objective names the objective.
 */
const predicate = (
  tr: Tr,
  entry: Extract<QuestDiscussionEntry, { kind: "event" }>,
): string => {
  if (entry.action === "created" && entry.feedbackId != null) {
    return String(
      tr("quest.event.createdFromFeedback", {
        args: [String(entry.feedbackId)],
      }),
    );
  }
  if (entry.action === "objective_completed" && entry.subject) {
    return String(
      tr("quest.event.objectiveCompleted", { args: [entry.subject] }),
    );
  }
  return String(tr(PREDICATE_KEYS[entry.action] ?? "quest.event.updated"));
};

const ICONS: Record<string, LucideIcon> = {
  created: Sunrise,
  assigned: Signature,
  unassigned: UserMinus,
  completed: Swords,
  objective_completed: CheckSquare,
  reminder_sent: BellRing,
  shelved: Archive,
  unshelved: ArchiveRestore,
  updated: Pencil,
};

const PREDICATE_KEYS: Record<
  string,
  | "quest.event.created"
  | "quest.event.assigned"
  | "quest.event.unassigned"
  | "quest.event.completed"
  | "quest.event.objectiveCompletedBare"
  | "quest.event.reminderSent"
  | "quest.event.shelved"
  | "quest.event.unshelved"
  | "quest.event.updated"
> = {
  created: "quest.event.created",
  assigned: "quest.event.assigned",
  unassigned: "quest.event.unassigned",
  completed: "quest.event.completed",
  objective_completed: "quest.event.objectiveCompletedBare",
  reminder_sent: "quest.event.reminderSent",
  shelved: "quest.event.shelved",
  unshelved: "quest.event.unshelved",
  updated: "quest.event.updated",
};

export default QuestDiscussionEvent;
