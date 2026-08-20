import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import type { QuestCommentController } from "@/api/controllers/QuestCommentController.ts";
import type { QuestCommentResource } from "@/api/schemas/questCommentResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { useProjectUsers } from "../../shared/useProjectUsers.ts";
import QuestDiscussionComment from "./QuestDiscussionComment.tsx";
import QuestDiscussionEvent from "./QuestDiscussionEvent.tsx";
import { buildQuestDiscussionEntries } from "./questDiscussionEntries.ts";

export interface QuestDiscussionProps {
  quest: QuestResource;
}

type DiscussionFilter = "all" | "comments";

/**
 * The Discussion: the quest's own history events and the comments people
 * left on it, interleaved by timestamp into ONE feed.
 *
 * Never two lists. Two stacked feeds read as bolted on, and the interleaving
 * is what makes a quest read as something that happened rather than a record
 * that exists. The filter exists for the one case where the mixture gets in
 * the way — catching up on what was *said* — and defaults to everything.
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
  const [filter, setFilter] = useState<DiscussionFilter>("all");

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

  const entries = buildQuestDiscussionEntries(props.quest, comments);
  const shown =
    filter === "comments"
      ? entries.filter((e) => e.kind === "comment")
      : entries;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="text-muted-foreground shrink-0">
          <MessageSquare className="size-4" />
        </span>
        <span className="text-muted-foreground text-xs font-semibold tracking-[0.84px] whitespace-nowrap uppercase">
          {tr("quest.discussion.title")}
        </span>
        <div className="bg-border h-px flex-1 opacity-40" />
        <Segmented
          size="sm"
          value={filter}
          onChange={(value) => setFilter(value as DiscussionFilter)}
          options={[
            { value: "all", label: String(tr("quest.discussion.filter.all")) },
            {
              value: "comments",
              label: String(tr("quest.discussion.filter.comments")),
            },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground px-1 text-sm italic">
          {filter === "comments"
            ? tr("quest.discussion.empty.comments")
            : tr("quest.discussion.empty")}
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
    </div>
  );
};

export default QuestDiscussion;
