import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";

import type { QuestCommentController } from "@/api/controllers/QuestCommentController.ts";
import type { QuestCommentResource } from "@/api/schemas/questCommentResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

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
  const [comments, setComments] = useState<QuestCommentResource[]>([]);

  useEffect(() => {
    let alive = true;
    commentApi
      .listQuestComments({ params: { id: props.quest.id }, query: {} })
      .then((rows) => {
        if (alive) setComments(rows);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [props.quest.id]);

  const shown = buildQuestDiscussionEntries(props.quest, comments);

  return (
    // The shared collapsible, same as Description and Objectives. It used to
    // hand-roll its own header to stay permanently open, which made it the
    // one section with no chevron and no way to fold a long thread out of
    // the way. Still open by default: it is what a returning reader came for.
    <CollapsibleBlock
      icon={<MessageSquare className="size-5" />}
      label={String(tr("quest.discussion.title"))}
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
          onPosted={(comment) => setComments((prev) => [...prev, comment])}
        />
      )}
    </CollapsibleBlock>
  );
};

export default QuestDiscussion;
