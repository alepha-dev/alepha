import { Button } from "@alepha/ui";
import {
  currentProjectAtom,
  DiscussionAttachments,
  type DiscussionAttachment,
  DiscussionComposer,
  type I18n,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2, MessageSquareReply, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { QuestCommentController } from "../../../../../api/controllers/QuestCommentController.ts";
import type { QuestController } from "../../../../../api/controllers/QuestController.ts";
import type { QuestCommentResource } from "../../../../../api/schemas/questCommentResourceSchema.ts";
import { QUEST_NEEDS_ANSWER_TAG } from "../../../../../api/schemas/questPresets.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";

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
  /**
   * Called when the draft goes from empty to written and back: the quest
   * page holds its refresh while a comment is being typed (#Q3860).
   */
  onDraftChange?: (drafting: boolean) => void;
  /**
   * Called once an answer is posted: the server removed the quest's
   * `needs-answer` tag, so the page reads the quest again.
   */
  onAnswered?: () => void;
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
 * The layout is the shared `DiscussionComposer`, which a feedback item's
 * thread uses too.
 *
 * **Files belong to the comment.** Attach files, or a pasted image, adds a
 * tile above the box and goes out with the comment as its `attachments`: it
 * is neither inlined into the body nor added to the quest's own files.
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
 * **Answer**, on a quest tagged `needs-answer` only (#Q4348): the same post
 * with `answer: true`, which removes the tag server-side. Comment stays
 * beside it, for a reply that is not the answer.
 *
 * Autosaving an unsent draft is deliberately out of scope.
 */
const QuestDiscussionComposer = (props: QuestDiscussionComposerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const commentApi = useClient<QuestCommentController>();
  const [project] = useStore(currentProjectAtom);
  const questApi = useClient<QuestController>();
  const dateTime = useInject(DateTimeProvider);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<DiscussionAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Files waiting to go count as a draft too: a refresh must not drop them.
  const drafting = body.trim() !== "" || pending.length > 0 || uploading > 0;
  const onDraftChange = props.onDraftChange;
  useEffect(() => {
    onDraftChange?.(drafting);
  }, [drafting, onDraftChange]);
  // A draft left on a page being left must not hold the next one's refresh.
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

  // One file at a time ahead of the post, as a feedback comment does: the
  // comment then carries ids, and a refused file is the server's sentence,
  // toasted, without losing the ones before it.
  const uploadAction = useAction<[files: File[]], void>(
    {
      handler: async (_ctx, files) => {
        setUploading((n) => n + files.length);
        try {
          for (const file of files) {
            try {
              const uploaded = await questApi.uploadAttachment({
                body: { file },
              });
              setPending((prev) => [
                ...prev,
                {
                  id: uploaded.fileId,
                  url: uploaded.url,
                  name: file.name,
                  mimeType: file.type,
                  size: file.size,
                },
              ]);
            } finally {
              setUploading((n) => n - 1);
            }
          }
        } catch (error) {
          // The files after a refused one never started: drop their tiles.
          setUploading(0);
          throw error;
        }
      },
    },
    [questApi],
  );

  // A pasted image arrives as "image.png" every time, so it is named by
  // hand, as in a feedback thread.
  const onPasteFiles = (files: File[]) => {
    const named = files.map((file, index) => {
      const ext = file.name.includes(".")
        ? file.name.slice(file.name.lastIndexOf("."))
        : ".png";
      return new File([file], `pasted-${dateTime.nowMillis()}-${index}${ext}`, {
        type: file.type,
      });
    });
    void uploadAction.run(named);
  };

  // A `useAction` (#E59, #Q2328): a refused post is the server's sentence,
  // toasted by the root `ActionErrorToaster`, where it used to be an
  // unhandled rejection. The draft stays in the editor, since it is cleared
  // inside the handler on success only.
  const postAction = useAction<[answer?: boolean], void>(
    {
      handler: async (_ctx, answer) => {
        const trimmed = body.trim();
        if (!trimmed && pending.length === 0) return;
        const created = await commentApi.createQuestComment({
          params: { id: props.quest.id },
          body: {
            body: trimmed,
            ...(pending.length > 0
              ? { attachments: pending.map((file) => file.id) }
              : {}),
            ...(answer ? { answer: true } : {}),
          },
        });
        setBody("");
        setPending([]);
        props.onPosted(created);
        if (answer) props.onAnswered?.();
      },
    },
    [
      commentApi,
      body,
      pending,
      props.quest.id,
      props.onPosted,
      props.onAnswered,
    ],
  );
  const canSubmit = body.trim().length > 0 || pending.length > 0;
  const needsAnswer = (props.quest.tags ?? []).includes(QUEST_NEEDS_ANSWER_TAG);
  const posting = postAction.loading || uploadAction.loading;
  const canAttach = questApi.uploadAttachment.can();

  if (!project || !commentApi.createQuestComment.can()) return null;

  return (
    <DiscussionComposer
      element={{
        kind: "quest",
        projectId: props.quest.projectId,
        projectSlug: project.slug,
        id: props.quest.id,
      }}
      value={body}
      onChange={setBody}
      onSubmit={() => void postAction.run()}
      busy={posting}
      canSubmit={canSubmit}
      members={props.members}
      // Pasted images become the comment's attachments, never inline.
      imageUpload={false}
      onPasteFiles={canAttach ? onPasteFiles : undefined}
      attachments={
        <DiscussionAttachments
          items={pending}
          uploading={uploading}
          disabled={posting}
          onRemove={(id) =>
            setPending((prev) => prev.filter((file) => file.id !== id))
          }
        />
      }
      actions={
        <>
          {canAttach && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                data-testid="quest-comment-file"
                disabled={posting}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length > 0) void uploadAction.run(files);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outlined"
                disabled={posting}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadAction.loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Paperclip className="size-4" />
                )}
                {tr("discussion.attach")}
              </Button>
            </>
          )}
          {needsAnswer && (
            <Button
              type="button"
              size="sm"
              variant="outlined"
              disabled={posting || !canSubmit}
              onClick={() => void postAction.run(true)}
            >
              <MessageSquareReply className="size-4" />
              {tr("quest.discussion.composer.answer")}
            </Button>
          )}
        </>
      }
      placeholder={tr("quest.discussion.composer.placeholder")}
      submitLabel={tr("quest.discussion.composer.submit")}
    />
  );
};

export default QuestDiscussionComposer;
