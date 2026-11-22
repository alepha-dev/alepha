import { Button, useDialog } from "@alepha/ui";
import {
  type I18n,
  currentProjectAtom,
  useProjectUsers,
  mentionHandle,
  DiscussionAttachments,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useClient,
  useInject,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import type { FeedbackCommentController } from "../../../../../api/controllers/FeedbackCommentController.ts";
import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackCommentResource } from "../../../../../api/schemas/feedbackCommentResourceSchema.ts";
import DiscussionComment from "../discussion/DiscussionComment.tsx";
import DiscussionComposer from "../discussion/DiscussionComposer.tsx";
import FeedbackThreadBody from "./FeedbackThreadBody.tsx";

export interface FeedbackThreadProps {
  feedbackId: number;
  /**
   * The item's project. Attachments upload through the same project-scoped
   * endpoint as the item's own, so the thread needs it to offer the attach
   * control at all.
   */
  projectId?: number;
  /**
   * The signed-in account. Used only to decide which comments offer a
   * delete control; every gate that matters is enforced server-side.
   */
  currentUserId?: string;
  /**
   * True when the viewer owns the project. The owner may delete anyone's
   * comment, because deleting is moderation.
   */
  isOwner?: boolean;
  /**
   * The item's reporter. Their comments stay plain text; everyone else's
   * render as Markdown (#Q3451, see `FeedbackThreadBody`).
   */
  reporterUserId?: string;
  /**
   * Write in the rich `LoreEditor`, as on a quest. Set by the project's own
   * inbox; the reporter's sheet leaves it off and keeps a plain box, since
   * their words render as plain text and a toolbar would hand them syntax
   * they then see literally.
   */
  editor?: boolean;
}

/**
 * The conversation on one feedback item, mounted by both audiences: the
 * owner's triage inbox and the reporter's own feedback sheet.
 *
 * One component rather than two because the thread is the same thread. The
 * only asymmetry is who may delete what, and that is a server rule this
 * only mirrors.
 *
 * ## Who a mention here reaches
 *
 * A `@name` written by a **project member** reaches the member it names. One
 * written by anybody else reaches nobody, whatever it contains: the gate is
 * on the author, server-side, and a public feedback form is not going to be
 * an unsolicited-message channel. The copy under the box says which case the
 * reader is in.
 *
 * A body renders by its author (#Q3451): the reporter's own words stay plain
 * text, and a reply from the team or an agent renders as Markdown. See
 * `FeedbackThreadBody` for why the line sits there.
 */
const FeedbackThread = (props: FeedbackThreadProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<FeedbackCommentController>();
  const dialog = useDialog();
  const dateTime = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);
  // Empty outside the project shell, which is exactly the reporter's own
  // sheet: no roster to read there, and no handle should link.
  const projectUsers = useProjectUsers();
  const members = projectUsers.map((u) => ({ name: mentionHandle(u, "") }));

  const [draft, setDraft] = useState("");
  const feedbackApi = useClient<FeedbackController>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<
    Array<{ id: string; name: string; size: number; mimeType: string }>
  >([]);
  // Uploads still in flight, drawn as placeholder tiles.
  const [uploading, setUploading] = useState(0);
  const queries = useQueryClient();
  const commentsKey = ["feedback-comments", props.feedbackId];

  // A failure here costs the thread, not the page around it: the reporter
  // still needs to read their own report. Quiet through `onError` (#E59,
  // #Q2328), which keeps it out of the toaster and in error reporting.
  const comments =
    useQuery(
      {
        key: commentsKey,
        handler: () =>
          api.listFeedbackComments({
            params: { id: props.feedbackId },
            query: {},
          }),
        onError: () => {},
      },
      [api, props.feedbackId],
    ).data ?? [];

  // The two writes are `useAction`s: a refused post or delete is the
  // server's sentence, toasted by the root `ActionErrorToaster`, where it
  // used to vanish. Each answer is written into the thread's cache rather
  // than re-read, since the server already said what changed.
  const submitAction = useAction<[], void>(
    {
      handler: async () => {
        const body = draft.trim();
        if (!body && pending.length === 0) return;
        const created = await api.createFeedbackComment({
          params: { id: props.feedbackId },
          body: { body, attachments: pending.map((a) => a.id) },
        });
        queries.setData<FeedbackCommentResource[]>(commentsKey, (current) => [
          ...(current ?? []),
          created,
        ]);
        setDraft("");
        setPending([]);
      },
    },
    [api, draft, pending, props.feedbackId, queries],
  );

  // Uploaded one by one ahead of the post, the way the request form does:
  // the comment then carries ids, and a refused file is the server's
  // sentence, toasted, without losing the others.
  const uploadAction = useAction<[files: File[]], void>(
    {
      handler: async (_ctx, files) => {
        if (!props.projectId) return;
        setUploading((n) => n + files.length);
        try {
          for (const file of files) {
            try {
              const uploaded = await feedbackApi.uploadFeedbackAttachment({
                params: { projectId: props.projectId },
                body: { file },
              });
              setPending((prev) => [...prev, uploaded]);
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
    [feedbackApi, props.projectId],
  );

  const removeAction = useAction<[comment: FeedbackCommentResource], void>(
    {
      handler: async (_ctx, comment) => {
        const confirmed = await dialog.confirm({
          title: tr("feedback.thread.deleteTitle"),
          confirmLabel: tr("feedback.thread.delete"),
          destructive: true,
        });
        if (!confirmed) return;
        await api.deleteFeedbackComment({ params: { id: comment.id } });
        queries.setData<FeedbackCommentResource[]>(commentsKey, (current) =>
          (current ?? []).filter((it) => it.id !== comment.id),
        );
      },
    },
    [api, dialog, props.feedbackId, queries, tr],
  );

  // One thread, one busy flag: the box and every delete wait for either.
  const busy =
    submitAction.loading || removeAction.loading || uploadAction.loading;

  // A pasted screenshot, the commonest attachment there is, uploads without
  // a trip through the file picker. Named by hand: a pasted image arrives
  // as "image.png" every time.
  const onPasteFiles = (files: File[]) => {
    if (!props.projectId) return;
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

  return (
    // No heading of its own: the detail's `CollapsibleBlock` carries it. The
    // rows, the composer and the file tiles are the quest Discussion's own.
    <section className="flex flex-col">
      {/* No comment yet: the composer alone, no "nothing said" line (#Q4064). */}
      {comments.length > 0 && (
        <ol className="divide-border/40 flex flex-col divide-y px-1">
          {comments.map((comment) => (
            <DiscussionComment
              key={comment.id}
              author={comment.authorName ?? tr("feedback.thread.unknownAuthor")}
              // Written by a machine over MCP. Over MCP the account is the
              // owner's, so without this the reporter reads an agent's
              // triage note as the owner's own words.
              agent={comment.source ? {} : undefined}
              at={comment.createdAt}
              edited={!!comment.editedAt}
              actions={
                (props.isOwner || comment.authorId === props.currentUserId) && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-danger-text shrink-0"
                    aria-label={tr("feedback.thread.delete")}
                    disabled={busy}
                    onClick={() => void removeAction.run(comment)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )
              }
              footer={
                <DiscussionAttachments items={comment.attachmentUrls ?? []} />
              }
            >
              {/* The reporter's words stay plain text, deliberately: a
                  reporter is an outsider and this body is shown to the
                  project owner. A reply from the team or an agent renders
                  as Markdown (#Q3451). */}
              {comment.body && (
                <FeedbackThreadBody
                  body={comment.body}
                  members={members}
                  projectSlug={project?.slug}
                  markdown={
                    props.projectId !== undefined &&
                    comment.authorId !== undefined &&
                    comment.authorId !== props.reporterUserId
                      ? {
                          projectId: props.projectId,
                          feedbackId: props.feedbackId,
                        }
                      : undefined
                  }
                />
              )}
            </DiscussionComment>
          ))}
        </ol>
      )}

      <DiscussionComposer
        // The rich editor in the project's inbox only (#Q2069 overturned
        // there, 2026-11-19): the reporter's sheet keeps the plain box.
        element={
          props.editor && props.projectId !== undefined && project
            ? {
                kind: "feedback",
                projectId: props.projectId,
                projectSlug: project.slug,
                id: props.feedbackId,
              }
            : undefined
        }
        members={members.map((member) => member.name)}
        // Pasted images become the comment's own attachments, not part of
        // the body: the editor has no feedback upload arm.
        imageUpload={false}
        onPasteFiles={props.projectId ? onPasteFiles : undefined}
        value={draft}
        onChange={setDraft}
        onSubmit={() => void submitAction.run()}
        busy={busy}
        canSubmit={draft.trim().length > 0 || pending.length > 0}
        placeholder={tr("feedback.thread.placeholder")}
        submitLabel={tr("feedback.thread.submit")}
        hint={tr("feedback.thread.noNotification")}
        attachments={
          <DiscussionAttachments
            items={pending}
            uploading={uploading}
            disabled={busy}
            onRemove={(id) =>
              setPending((prev) => prev.filter((it) => it.id !== id))
            }
          />
        }
        actions={
          props.projectId && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                data-testid="feedback-thread-file"
                disabled={busy}
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
                disabled={busy}
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
          )
        }
      />
    </section>
  );
};

export default FeedbackThread;
