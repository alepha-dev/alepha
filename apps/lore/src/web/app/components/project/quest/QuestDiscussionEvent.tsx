import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  CheckSquare,
  type LucideIcon,
  Pencil,
  Signature,
  Sunrise,
  Swords,
  UserMinus,
} from "lucide-react";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { UserAvatar } from "../../shared/UserAvatar.tsx";
import type { ProjectUser } from "../../shared/useProjectUsers.ts";
import type { QuestDiscussionEntry } from "./questDiscussionEntries.ts";

export interface QuestDiscussionEventProps {
  entry: Extract<QuestDiscussionEntry, { kind: "event" }>;
  users: ProjectUser[];
}

/**
 * One system event in the Discussion: avatar, actor, a plain-text predicate,
 * relative time right-aligned. One line, no bubble — the shape is what
 * separates an event from a comment at a glance.
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

  const user = entry.by
    ? props.users.find((u) => u.id === entry.by)
    : undefined;
  const actor = entry.by
    ? displayName(user, entry.by)
    : tr("quest.discussion.author.unknown");

  const Icon = ICONS[entry.action] ?? Pencil;

  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <UserAvatar fileId={user?.picture} className="size-5" alt="" />
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        <span className="font-medium">{actor}</span>{" "}
        <span className="text-muted-foreground">{predicate(tr, entry)}</span>
      </span>
      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
        {dt.of(entry.at).fromNow()}
      </span>
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
