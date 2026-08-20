import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MessageSquare } from "lucide-react";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { displayName } from "@/web/app/services/displayName.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import LoreViewer from "../../shared/element/LoreViewer.tsx";
import type { ProjectUser } from "../../shared/useProjectUsers.ts";
import { expandCommentReferences } from "./commentReferences.ts";
import type { QuestDiscussionEntry } from "./questDiscussionEntries.ts";

export interface QuestDiscussionCommentProps {
  entry: Extract<QuestDiscussionEntry, { kind: "comment" }>;
  users: ProjectUser[];
}

/**
 * One comment in the Discussion, in the feed's two-column shape: the
 * author's avatar in the gutter, then the same header line a system event
 * uses with the word "commented", then the body underneath.
 *
 * Two things separate a comment from an event without reading either: the
 * gutter holds a face rather than a glyph, and only a comment has a body.
 */
const QuestDiscussionComment = (props: QuestDiscussionCommentProps) => {
  const { entry } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);

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
    <li className="flex gap-3 py-3">
      {/* The same bordered circle every event uses, carrying a chat glyph.
          A comment is an entry in the feed like any other, so the gutter
          keeps one shape: an avatar there made comments the only rows with
          a face, at a size that broke the column's rhythm. Who wrote it is
          already the first thing on the line beside it. */}
      <span className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border">
        <MessageSquare className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* `min-h-7` matches the circle so the header line is centred on it
            rather than sitting on its text baseline. */}
        <div className="flex min-h-7 items-center gap-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{author}</span>{" "}
            <span className="text-muted-foreground">
              {tr("quest.discussion.commented")}
            </span>
          </span>
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {entry.comment.editedAt && (
              <span className="mr-1 italic">
                {tr("quest.discussion.edited")}
              </span>
            )}
            {dt.of(entry.at).fromNow()}
          </span>
        </div>
        <div className="border-border bg-muted/40 rounded-md border px-3 py-3">
          {/* Through the shared viewer, so `[[folio]]` and `[[quest:#N]]`
            resolve exactly as they do in a description — with the two
            conversation-only shapes (`#1204`, `@member`) expanded into it
            first. The stored body is never rewritten. */}
          <LoreViewer
            element={{
              // `projectId` addresses the API, `projectSlug` the links the
              // rewrite produces, and `id` is the element itself. Passing the
              // quest id as the project id resolves every reference against an
              // empty quest list, so every link comes back broken.
              kind: "quest",
              projectId: project?.id ?? 0,
              projectSlug: project?.slug ?? "",
              id: entry.comment.questId,
            }}
            content={expandCommentReferences(entry.comment.body, {
              projectSlug: project?.slug ?? "",
              members: props.users.map((u) => ({
                name: displayName(u, ""),
              })),
            })}
          />
        </div>
      </div>
    </li>
  );
};

export default QuestDiscussionComment;
