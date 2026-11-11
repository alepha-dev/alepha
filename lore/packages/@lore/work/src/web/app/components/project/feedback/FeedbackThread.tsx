import { FileImage, TimeAgo, Button, Textarea, useDialog } from "@alepha/ui";
import {
  type I18n,
  currentProjectAtom,
  displayName,
  useProjectUsers,
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
import {
  Bot,
  Loader2,
  MessageSquare,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";
import { type ClipboardEvent, useRef, useState } from "react";

import type { FeedbackCommentController } from "../../../../../api/controllers/FeedbackCommentController.ts";
import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackCommentResource } from "../../../../../api/schemas/feedbackCommentResourceSchema.ts";
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
 * The body is still plain text with no markdown - see `FeedbackThreadBody`
 * for what that costs and what it keeps.
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
  const members = projectUsers.map((u) => ({ name: displayName(u, "") }));

  const [draft, setDraft] = useState("");
  const feedbackApi = useClient<FeedbackController>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<
    Array<{ id: string; name: string; size: number; mimeType: string }>
  >([]);
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
        for (const file of files) {
          const uploaded = await feedbackApi.uploadFeedbackAttachment({
            params: { projectId: props.projectId },
            body: { file },
          });
          setPending((prev) => [...prev, uploaded]);
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
  const onPaste = (event: ClipboardEvent) => {
    if (!props.projectId) return;
    const pasted = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file)
      .map((file, index) => {
        const ext = file.name.includes(".")
          ? file.name.slice(file.name.lastIndexOf("."))
          : ".png";
        return new File(
          [file],
          `pasted-${dateTime.nowMillis()}-${index}${ext}`,
          {
            type: file.type,
          },
        );
      });
    if (pasted.length === 0) return;
    event.preventDefault();
    void uploadAction.run(pasted);
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase">
        <MessageSquare className="size-3.5" />
        {tr("feedback.thread.title")}
      </h3>

      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tr("feedback.thread.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="border-border bg-muted/40 flex flex-col gap-1 rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">
                  {comment.authorName ?? tr("feedback.thread.unknownAuthor")}
                </span>
                {/* Written by a machine over MCP. Over MCP the account is
                    the owner's, so without this the reporter reads an
                    agent's triage note as the owner's own words. */}
                {comment.source && (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Bot className="size-3" />
                    {tr("feedback.thread.agent")}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto">
                  {comment.editedAt && (
                    <span className="mr-1 italic">
                      {tr("feedback.thread.edited")}
                    </span>
                  )}
                  <TimeAgo value={comment.createdAt} />
                </span>
                {(props.isOwner ||
                  comment.authorId === props.currentUserId) && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-danger-text"
                    aria-label={tr("feedback.thread.delete")}
                    disabled={busy}
                    onClick={() => void removeAction.run(comment)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              {/* The reporter's words stay plain text, deliberately: a
                  reporter is an outsider and this body is shown to the
                  project owner, the same reason a blight's fields are never
                  rendered as markdown. A reply from the team or an agent
                  renders as Markdown (#Q3451). */}
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
              {comment.attachmentUrls && comment.attachmentUrls.length > 0 && (
                <ul className="flex flex-wrap gap-2 pt-1">
                  {comment.attachmentUrls.map((file) => (
                    <li key={file.id}>
                      {/* A real anchor: the browser opens the file in a tab,
                          for an image and for anything else. */}
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="border-border bg-background hover:bg-muted flex items-center gap-2 rounded border px-2 py-1 text-xs"
                      >
                        {file.mimeType.startsWith("image/") ? (
                          <FileImage
                            id={file.id}
                            alt={file.name}
                            className="size-16 rounded object-cover"
                          />
                        ) : (
                          <>
                            <Paperclip className="size-3.5 shrink-0" />
                            <span className="max-w-48 truncate">
                              {file.name}
                            </span>
                          </>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {/* ⚠️ A `Textarea`, and it stays one (#Q2069, owner's ruling
            2026-09-07). Every other markdown surface in Lore is a
            `LoreEditor`, so this reads like an oversight and has been swept
            for once already.

            It is not. `FeedbackThreadBody` renders this body as PLAIN TEXT
            on purpose - a reporter is an outsider and the body is shown to
            the project owner - so a format toolbar here would produce
            syntax the reader sees literally, and would put pressure on the
            renderer to start interpreting outsider input. The editor and
            the renderer are one decision; changing only this half is the
            wrong half. */}
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={onPaste}
          placeholder={tr("feedback.thread.placeholder")}
          rows={3}
          disabled={busy}
        />
        {pending.length > 0 && (
          <ul className="flex flex-col gap-1">
            {pending.map((file) => (
              <li
                key={file.id}
                className="border-border bg-muted/20 flex items-center gap-2 rounded border px-2 py-1 text-sm"
              >
                {file.mimeType.startsWith("image/") ? (
                  <FileImage
                    id={file.id}
                    alt=""
                    className="size-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="size-3.5 shrink-0" />
                )}
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-muted-foreground text-xs">
                  {Math.round(file.size / 1024)} KB
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={tr("feedback.thread.removeAttachment")}
                  disabled={busy}
                  onClick={() =>
                    setPending((prev) => prev.filter((it) => it.id !== file.id))
                  }
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {tr("feedback.thread.noNotification")}
          </span>
          {props.projectId && (
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
                className="ml-auto"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadAction.loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Paperclip className="size-4" />
                )}
                {tr("feedback.thread.attach")}
              </Button>
            </>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => void submitAction.run()}
            disabled={
              busy || (draft.trim().length === 0 && pending.length === 0)
            }
          >
            {tr("feedback.thread.submit")}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default FeedbackThread;
