import { useClient, useQuery, useQueryClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MessageSquare } from "lucide-react";

import type { QuestCommentController } from "@/api/controllers/QuestCommentController.ts";
import type { QuestCommentResource } from "@/api/schemas/questCommentResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { displayName } from "../../../services/displayName.ts";
import CollapsibleBlock from "../../shared/CollapsibleBlock.tsx";
import { useProjectUsers } from "../../shared/useProjectUsers.ts";
import QuestDiscussionComment from "./QuestDiscussionComment.tsx";
import QuestDiscussionComposer from "./QuestDiscussionComposer.tsx";
import { buildQuestDiscussionEntries } from "./questDiscussionEntries.ts";
import QuestDiscussionEvent from "./QuestDiscussionEvent.tsx";

export interface QuestDiscussionProps {
  quest: QuestResource;
}

/**
 * The Discussion: the quest's own history events and the comments people
 * left on it, interleaved by timestamp into ONE feed.
 *
 * Never two lists. Two stacked feeds read as bolted on, and the interleaving
 * is what makes a quest read as something that happened rather than a record
 * that exists.
 *
 * There is no comments-only filter. It sat in the section header defaulted
 * to everything, which meant a permanent control for a view almost nobody
 * switched to, on the one section that should just be read.
 *
 * Replaces `QuestHistory` / `QuestHistoryTimeline`, which derived its rows
 * client-side with hardcoded English RPG titles and a hardcoded "by You" for
 * every actor.
 *
 * Ships without notifications, deliberately: comments create an expectation
 * that someone is told, and that is a separate feature.
 */
const QuestDiscussion = (props: QuestDiscussionProps) => {
  const { tr } = useI18n<I18n, "en">();
  const commentApi = useClient<QuestCommentController>();
  const users = useProjectUsers();
  const queries = useQueryClient();

  // ⚠️ Keyed on `updatedAt`, not just the id. A quest write can ADD a comment
  // without the reader touching the composer: `holdQuest` posts its reason
  // into this thread in the same transaction. Keyed on the id alone, the
  // reason the user just typed never appeared until a full page load - the
  // one place it is meant to be read. Every quest mutation costs one small
  // list call, which is what keeps the thread honest after any of them.
  //
  // A `useQuery` (#E59, #Q2328). The answer carries the quest it was read
  // for: `keepPreviousData` holds the thread through the re-read a mutation
  // causes, and must never show one quest's thread under the next. A failed
  // read toasts now; it used to leave "no comments yet" standing over a
  // thread that has some.
  const commentsKey = ["quest-comments", props.quest.id, props.quest.updatedAt];
  const commentsQuery = useQuery(
    {
      key: commentsKey,
      keepPreviousData: true,
      handler: async () => ({
        questId: props.quest.id,
        rows: await commentApi.listQuestComments({
          params: { id: props.quest.id },
          query: {},
        }),
      }),
    },
    [commentApi, props.quest.id, props.quest.updatedAt],
  );
  const comments =
    commentsQuery.data?.questId === props.quest.id
      ? commentsQuery.data.rows
      : NO_COMMENTS;

  const shown = buildQuestDiscussionEntries(props.quest, comments);

  return (
    // The shared collapsible, same as Description and Objectives. It used to
    // hand-roll its own header to stay permanently open, which made it the
    // one section with no chevron and no way to fold a long thread out of
    // the way. Still open by default: it is what a returning reader came for.
    <CollapsibleBlock
      icon={<MessageSquare className="size-5" />}
      label={tr("quest.discussion.title")}
      defaultOpen
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground px-1 text-sm italic">
          {tr("quest.discussion.empty")}
        </p>
      ) : (
        <ol className="divide-border/40 flex flex-col divide-y px-1">
          {shown.map((entry) =>
            entry.kind === "comment" ? (
              <QuestDiscussionComment
                key={entry.key}
                entry={entry}
                users={users}
              />
            ) : (
              <QuestDiscussionEvent
                key={entry.key}
                entry={entry}
                users={users}
              />
            ),
          )}
        </ol>
      )}

      {/* Never on a completed quest: its body is frozen as an audit record,
          and the API refuses the write anyway. */}
      {!props.quest.completedAt && (
        <QuestDiscussionComposer
          quest={props.quest}
          // The `@` picker's roster, from the list this component already
          // holds to render each comment's author - so it costs no request.
          // Through `displayName` because that is what `resolveMention`
          // compares against: a roster built any other way disagrees with
          // the renderer and the notifier about what `@nfo` is.
          members={users.map((user) => displayName(user))}
          // Written into the thread's cache: the server already answered
          // with the row.
          onPosted={(comment) => {
            const current = commentsQuery.data;
            if (current?.questId !== props.quest.id) return;
            queries.setData(commentsKey, {
              ...current,
              rows: [...current.rows, comment],
            });
          }}
        />
      )}
    </CollapsibleBlock>
  );
};

export default QuestDiscussion;

/**
 * One empty thread, so a quest whose comments are loading keeps the entries'
 * identity across renders.
 */
const NO_COMMENTS: QuestCommentResource[] = [];
