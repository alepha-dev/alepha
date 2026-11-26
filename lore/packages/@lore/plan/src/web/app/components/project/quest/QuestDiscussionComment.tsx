import {
  currentProjectAtom,
  displayName,
  type I18n,
  LoreViewer,
  type ProjectUser,
  mentionHandle,
  DiscussionAttachments,
  DiscussionComment,
  expandCommentReferences,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { QuestDiscussionEntry } from "./questDiscussionEntries.ts";

export interface QuestDiscussionCommentProps {
  entry: Extract<QuestDiscussionEntry, { kind: "comment" }>;
  users: ProjectUser[];
}

/**
 * One comment in the quest's Discussion: the shared `DiscussionComment` row,
 * with the body rendered as Markdown.
 */
const QuestDiscussionComment = (props: QuestDiscussionCommentProps) => {
  const { entry } = props;
  const { tr } = useI18n<I18n, "en">();
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
    <DiscussionComment
      author={author}
      // Written by a machine over MCP. `authorId` is still an account, and
      // over MCP that account is the project owner's, so without this marker
      // half of a thread reads as the owner talking to themselves.
      agent={
        entry.comment.source
          ? { title: entry.comment.source.client ?? undefined }
          : undefined
      }
      at={entry.at}
      edited={!!entry.comment.editedAt}
      footer={
        <DiscussionAttachments items={entry.comment.attachmentUrls ?? []} />
      }
    >
      {entry.comment.body.trim() && (
        <>
          {/* Through the shared viewer, so `[[#F12]]` and `[[#Q12]]` resolve
          exactly as they do in a description, with the two
          conversation-only shapes (`#Q1204`, `@member`) expanded into it
          first. The stored body is never rewritten. */}
          <LoreViewer
            // The box's padding alone sets its edges (#Q3660): the first and
            // last prose blocks carry their own `my-3`, which doubled it on top
            // and bottom.
            className="[&>:first-child]:mt-0 [&>:last-child]:mb-0"
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
                name: mentionHandle(u, ""),
              })),
            })}
          />
        </>
      )}
    </DiscussionComment>
  );
};

export default QuestDiscussionComment;
