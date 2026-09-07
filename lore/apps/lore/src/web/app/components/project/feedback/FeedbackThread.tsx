import { Button } from "@alepha/ui/components/ui/button";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bot, MessageSquare, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { FeedbackCommentController } from "@/api/controllers/FeedbackCommentController.ts";
import type { FeedbackCommentResource } from "@/api/schemas/feedbackCommentResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { displayName } from "../../../services/displayName.ts";
import { useProjectUsers } from "../../shared/useProjectUsers.ts";
import FeedbackThreadBody from "./FeedbackThreadBody.tsx";

export interface FeedbackThreadProps {
  feedbackId: number;
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
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  // Empty outside the project shell, which is exactly the reporter's own
  // sheet: no roster to read there, and no handle should link.
  const projectUsers = useProjectUsers();
  const members = projectUsers.map((u) => ({ name: displayName(u, "") }));

  const [comments, setComments] = useState<FeedbackCommentResource[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await api.listFeedbackComments({
      params: { id: props.feedbackId },
      query: {},
    });
    setComments(rows);
  }, [api, props.feedbackId]);

  useEffect(() => {
    // A failure here costs the thread, not the page around it: the reporter
    // still needs to read their own report.
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because the loader flips
    // `loading` before its first await.
    // oxlint-disable-next-line react/set-state-in-effect
    load().catch(() => setComments([]));
  }, [load]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const created = await api.createFeedbackComment({
        params: { id: props.feedbackId },
        body: { body },
      });
      setComments((current) => [...current, created]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (comment: FeedbackCommentResource) => {
    const confirmed = await dialog.confirm({
      title: String(tr("feedback.thread.deleteTitle")),
      confirmLabel: String(tr("feedback.thread.delete")),
      destructive: true,
    });
    if (!confirmed) return;
    await api.deleteFeedbackComment({ params: { id: comment.id } });
    setComments((current) => current.filter((it) => it.id !== comment.id));
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
                {comment.source?.kind === "mcp" && (
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
                  {dt.of(comment.createdAt).fromNow()}
                </span>
                {(props.isOwner ||
                  comment.authorId === props.currentUserId) && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={String(tr("feedback.thread.delete"))}
                    onClick={() => remove(comment)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              {/* Still plain text, deliberately: a reporter is an outsider
                  and this body is shown to the project owner, the same
                  reason a blight's fields are never rendered as markdown.
                  The one exception is a resolved mention, which becomes an
                  element rather than markup. */}
              <FeedbackThreadBody
                body={comment.body}
                members={members}
                projectSlug={project?.slug}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={String(tr("feedback.thread.placeholder"))}
          rows={3}
          disabled={busy}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {tr("feedback.thread.noNotification")}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={busy || draft.trim().length === 0}
          >
            {tr("feedback.thread.submit")}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default FeedbackThread;
