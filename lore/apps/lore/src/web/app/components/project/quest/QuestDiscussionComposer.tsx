import { Button, UserAvatar } from "@alepha/ui";
import { useAction, useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Send } from "lucide-react";
import { useState } from "react";

import type { QuestCommentController } from "@/api/controllers/QuestCommentController.ts";
import type { QuestCommentResource } from "@/api/schemas/questCommentResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import LoreEditor from "../../shared/element/LoreEditor.tsx";

export interface QuestDiscussionComposerProps {
  quest: QuestResource;
  /**
   * The handles the `@` picker offers, already through `displayName`.
   *
   * Passed in rather than fetched here: the Discussion holds this list to
   * name each comment's author, so the composer costs no request of its own.
   */
  members: string[];
  onPosted: (comment: QuestCommentResource) => void;
}

/**
 * The composer at the foot of the Discussion.
 *
 * A `LoreEditor` like every other markdown surface in Lore. It was a plain
 * `Textarea` with "Markdown supported" written under it as an apology, on the
 * argument that mounting CodeMirror to write a paragraph costs more than it
 * is worth. It was the one surface that opted out, and everything it was
 * missing is what a comment actually wants: the format toolbar, the floating
 * selection toolbar, `[[#` completion over folios, quests, epics and
 * releases, and image paste straight into the quest's own attachments.
 *
 * Everything follows from `element` - `useElementImageUpload` already has a
 * quest arm and `useElementLinks` already supplies the suggestions - so this
 * component holds no editor configuration of its own.
 *
 * ⚠️ **Two costs, both accepted by the owner on 2026-09-07.**
 *
 * The CodeMirror chunk now loads on every quest page, where the read-only
 * description never mounted it. `QuestView` calls `preloadMarkdownEditor()`
 * so the import is warm rather than paid at the first click.
 *
 * **⌘↵ no longer posts.** It was an `onKeyDown` on the textarea; CodeMirror
 * owns its keymap and restoring it means an extension. The handler is deleted
 * rather than left dead.
 *
 * ⚠️ The READ side is untouched. `QuestDiscussionComment` renders through
 * `LoreViewer` with `expandCommentReferences` in front of it, which is what
 * resolves a bare `#Q1204` and a matched `@name`. That rewrite runs on the
 * way OUT and never on the stored body.
 *
 * Autosaving an unsent draft is deliberately out of scope.
 */
const QuestDiscussionComposer = (props: QuestDiscussionComposerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const commentApi = useClient<QuestCommentController>();
  const auth = useAuth();
  const [project] = useStore(currentProjectAtom);
  const [body, setBody] = useState("");

  // A `useAction` (#E59, #Q2328): a refused post is the server's sentence,
  // toasted by the root `ActionErrorToaster`, where it used to be an
  // unhandled rejection. The draft stays in the editor, since it is cleared
  // inside the handler on success only.
  const postAction = useAction<[], void>(
    {
      handler: async () => {
        const trimmed = body.trim();
        if (!trimmed) return;
        const created = await commentApi.createQuestComment({
          params: { id: props.quest.id },
          body: { body: trimmed },
        });
        setBody("");
        props.onPosted(created);
      },
    },
    [commentApi, body, props.quest.id, props.onPosted],
  );
  const posting = postAction.loading;

  if (!project || !commentApi.createQuestComment.can()) return null;

  return (
    // Same gutter as the rows above, so the composer reads as the next entry
    // in the feed rather than a form bolted under it.
    <div className="flex gap-3 px-1 pt-3">
      <UserAvatar
        public
        fileId={(auth.user as { picture?: string } | undefined)?.picture}
        className="mt-1 size-7 shrink-0"
        alt=""
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <LoreEditor
          element={{
            kind: "quest",
            projectId: props.quest.projectId,
            projectSlug: project.slug,
            id: props.quest.id,
          }}
          // `field`, so the fixed format toolbar is on and the height is a
          // box on a form rather than a document.
          variant="field"
          value={body}
          onChange={setBody}
          // ⚠️ A real freeze, not a `disabled` the editor would ignore: it
          // reaches CodeMirror's own `readOnly` through the wrapper. The
          // button below disables at the same moment, so the two agree.
          readOnly={posting}
          // ⚠️ The one surface that gets `@`, and the scoping IS the feature:
          // `expandCommentReferences` and `MentionNotifier` only run over
          // comments, so a picker on a description or a folio body would
          // offer a handle that links nowhere and pings nobody.
          mentionSuggestions={props.members}
          minHeight={120}
          placeholder={tr("quest.discussion.composer.placeholder")}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            disabled={posting || !body.trim()}
            onClick={() => void postAction.run()}
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
