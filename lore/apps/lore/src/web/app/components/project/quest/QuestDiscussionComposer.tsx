import { Button } from "@alepha/ui/components/ui/button";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Send } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import type { QuestCommentController } from "@/api/controllers/QuestCommentController.ts";
import type { QuestCommentResource } from "@/api/schemas/questCommentResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { UserAvatar } from "../../shared/UserAvatar.tsx";

export interface QuestDiscussionComposerProps {
  quest: QuestResource;
  onPosted: (comment: QuestCommentResource) => void;
}

/**
 * The composer at the foot of the Discussion.
 *
 * A plain textarea, not the markdown editor: a comment is a paragraph, and
 * mounting CodeMirror at the bottom of every quest page to write one would
 * cost more than it is worth. `Markdown supported` says what the body does
 * with it; the feed renders it through the same viewer the description uses,
 * so `[[#F12]]`, `#Q1204` and `@member` all resolve.
 *
 * **⌘↵ posts** as well as the button. Deciding it here rather than leaving it
 * open: the textarea is the only focusable thing in the section, so a reader
 * who has just typed has nowhere else to be, and every comment box they have
 * used elsewhere behaves this way. Plain ↵ stays a newline — a comment is
 * often more than one line.
 *
 * Autosaving an unsent draft is deliberately out of scope.
 */
const QuestDiscussionComposer = (props: QuestDiscussionComposerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const commentApi = useClient<QuestCommentController>();
  const auth = useAuth();
  const [project] = useStore(currentProjectAtom);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  if (!project || !commentApi.createQuestComment.can()) return null;

  const post = async () => {
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const created = await commentApi.createQuestComment({
        params: { id: props.quest.id },
        body: { body: trimmed },
      });
      setBody("");
      props.onPosted(created);
    } finally {
      setPosting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void post();
    }
  };

  return (
    // Same gutter as the rows above, so the composer reads as the next entry
    // in the feed rather than a form bolted under it.
    <div className="flex gap-3 px-1 pt-3">
      <UserAvatar
        fileId={(auth.user as { picture?: string } | undefined)?.picture}
        className="mt-1 size-7 shrink-0"
        alt=""
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={posting}
          rows={3}
          placeholder={String(tr("quest.discussion.composer.placeholder"))}
          aria-label={String(tr("quest.discussion.composer.placeholder"))}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {tr("quest.discussion.composer.markdown")}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={posting || !body.trim()}
            onClick={() => void post()}
          >
            <Send className="size-4" />
            {tr("quest.discussion.composer.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default QuestDiscussionComposer;
