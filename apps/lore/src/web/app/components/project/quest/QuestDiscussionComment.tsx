import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { UserAvatar } from "../../shared/UserAvatar.tsx";
import type { ProjectUser } from "../../shared/useProjectUsers.ts";
import type { QuestDiscussionEntry } from "./questDiscussionEntries.ts";

export interface QuestDiscussionCommentProps {
  entry: Extract<QuestDiscussionEntry, { kind: "comment" }>;
  users: ProjectUser[];
}

/**
 * One comment in the Discussion: the same header line as a system event,
 * with the word "commented", then the body in a bordered bubble underneath.
 *
 * The bubble is the whole distinction. Events are one line and comments have
 * a body, so a reader can tell what a row is before reading it.
 */
const QuestDiscussionComment = (props: QuestDiscussionCommentProps) => {
  const { entry } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  const user = entry.by
    ? props.users.find((u) => u.id === entry.by)
    : undefined;
  // A member can delete their account, and `authorId` is set-null rather than
  // cascade so their side of the conversation survives. This is the tombstone
  // that decision buys.
  const author = entry.by
    ? displayName(user, entry.by)
    : tr("quest.discussion.author.unknown");

  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center gap-2 text-sm">
        <UserAvatar fileId={user?.picture} className="size-5" alt="" />
        <span className="min-w-0 truncate">
          <span className="font-medium">{author}</span>{" "}
          <span className="text-muted-foreground">
            {tr("quest.discussion.commented")}
          </span>
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
          {entry.comment.editedAt && (
            <span className="mr-1 italic">{tr("quest.discussion.edited")}</span>
          )}
          {dt.of(entry.at).fromNow()}
        </span>
      </div>
      <div className="border-border bg-muted/40 ml-7 rounded-md border px-3 py-2">
        <MarkdownView content={entry.comment.body} />
      </div>
    </li>
  );
};

export default QuestDiscussionComment;
