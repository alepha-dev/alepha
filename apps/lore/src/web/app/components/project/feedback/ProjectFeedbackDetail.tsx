import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { ExternalLink, Paperclip, Plus } from "lucide-react";
import { Fragment, useState } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import QuestCreate from "../quest/QuestCreate.tsx";
import FeedbackThread from "./FeedbackThread.tsx";

export interface ProjectFeedbackDetailProps {
  feedback: FeedbackResource;
  onChanged: () => void;
  onBack?: () => void;
}

const ProjectFeedbackDetail = (props: ProjectFeedbackDetailProps) => {
  const { feedback } = props;
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [currentUser] = useStore(currentUserAtom);
  const feedbackApi = useClient<FeedbackController>();
  const router = useRouter<AppRouter>();
  const toaster = useToast();
  const dialog = useDialog();

  const [busy, setBusy] = useState(false);
  const [questCreateOpen, setQuestCreateOpen] = useState(false);

  if (!project) return null;

  const handlePromote = async () => {
    setBusy(true);
    try {
      if (feedback.status === "pending") {
        await feedbackApi.acceptFeedback({
          params: { projectId: project.id, feedbackId: feedback.id },
        });
        toaster.show(tr("feedback.acceptedToast"), "success");
      }
      setQuestCreateOpen(true);
    } catch (err: any) {
      toaster.show(err?.message ?? tr("feedback.acceptError"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleQuestCreated = () => {
    setQuestCreateOpen(false);
    props.onChanged();
  };

  const handleReject = async () => {
    setBusy(true);
    try {
      await feedbackApi.rejectFeedback({
        params: { projectId: project.id, feedbackId: feedback.id },
      });
      toaster.show(tr("feedback.rejected"), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(err?.message ?? tr("feedback.rejectError"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await dialog.confirm({
      title: tr("feedback.deleteConfirmTitle"),
      description: tr("feedback.deleteConfirm"),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await feedbackApi.removeFeedback({
        params: { projectId: project.id, feedbackId: feedback.id },
      });
      toaster.show(tr("feedback.deleted"), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(err?.message ?? tr("feedback.deleteError"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const linkedQuests = feedback.linkedQuests ?? [];
  const tags = feedback.tags ?? [];

  const questStatusColor: Record<string, string> = {
    new: "bg-slate-500/20 text-slate-300",
    accepted: "bg-amber-500/20 text-amber-300",
    completed: "bg-emerald-500/20 text-emerald-300",
    shelved: "bg-muted text-muted-foreground",
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border flex items-start gap-3 border-b p-4">
        {props.onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onBack}
            className="md:hidden"
          >
            {tr("feedback.back")}
          </Button>
        )}
        <h2 className="flex-1 text-base font-semibold">{feedback.title}</h2>
        <Badge variant="secondary" className="uppercase">
          {feedback.status}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="font-mono text-[11px]"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <section>
          <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
            {tr("feedback.description")}
          </h3>
          <p className="whitespace-pre-wrap text-sm">{feedback.description}</p>
        </section>

        {feedback.attachmentUrls && feedback.attachmentUrls.length > 0 && (
          <section>
            <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
              {tr("feedback.attachments")}
            </h3>
            <ul className="flex flex-col gap-1">
              {feedback.attachmentUrls.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm hover:underline"
                  >
                    <Paperclip className="size-3.5" />
                    <span className="truncate">{a.name}</span>
                    <span className="text-muted-foreground text-xs">
                      ({Math.round(a.size / 1024)} KB)
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {feedback.status === "accepted" && (
          <section data-testid="feedback-linked-quests">
            <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
              {tr("feedback.linkedQuests")}
            </h3>
            {linkedQuests.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {tr("feedback.noLinkedQuests")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {linkedQuests.map((q) => (
                  <li key={q.id}>
                    <a
                      href={router.path("projectQuest", {
                        params: {
                          projectSlug: project.slug,
                          shortId: String(q.shortId),
                        },
                      })}
                      className="bg-muted/30 hover:bg-muted/60 flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"
                      data-testid={`linked-quest-${q.id}`}
                    >
                      <ExternalLink className="size-3.5" />
                      <span className="flex-1 truncate">{q.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          questStatusColor[q.status] ?? ""
                        }`}
                      >
                        {q.status}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {(feedback.reporter || feedback.source) && (
          <section className="bg-muted/30 rounded border border-border p-3 text-xs">
            <h3 className="text-muted-foreground mb-2 font-medium uppercase tracking-wide">
              {tr("feedback.context.title")}
            </h3>
            {/* Provenance fields are attacker-controlled — rendered as escaped
                plain text only (never as links/markdown). See folio #12. */}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {feedback.reporter && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("feedback.context.reporter")}
                  </dt>
                  <dd>
                    {feedback.reporter.name ??
                      feedback.reporter.username ??
                      feedback.reporter.id}
                  </dd>
                </>
              )}
              {feedback.source &&
                (
                  [
                    ["feedback.context.page", feedback.source.hostUrl],
                    ["feedback.context.title2", feedback.source.title],
                    ["feedback.context.referrer", feedback.source.referrer],
                    ["feedback.context.userAgent", feedback.source.userAgent],
                    ["feedback.context.language", feedback.source.language],
                    ["feedback.context.viewport", feedback.source.viewport],
                    ["feedback.context.screen", feedback.source.screen],
                    ["feedback.context.timezone", feedback.source.timezone],
                  ] as const
                )
                  .filter(([, value]) => !!value)
                  .map(([labelKey, value]) => (
                    <Fragment key={labelKey}>
                      <dt className="text-muted-foreground">{tr(labelKey)}</dt>
                      <dd className="break-all">{value}</dd>
                    </Fragment>
                  ))}
            </dl>
          </section>
        )}

        {/* The thread, under the item's own content: triage findings and
            questions to the reporter used to have nowhere to live but a
            quest that might never be created. */}
        <section className="border-border border-t p-3">
          <FeedbackThread
            feedbackId={feedback.id}
            currentUserId={currentUser?.id}
            isOwner={project.createdBy === currentUser?.id}
          />
        </section>
      </div>

      {feedback.status === "pending" && (
        <div className="border-border flex flex-wrap justify-end gap-2 border-t p-3">
          <Button variant="ghost" onClick={handleDelete} disabled={busy}>
            {tr("feedback.delete")}
          </Button>
          <Button variant="outline" onClick={handleReject} disabled={busy}>
            {tr("feedback.reject")}
          </Button>
          <Button
            onClick={handlePromote}
            disabled={busy}
            data-testid="feedback-accept-button"
          >
            <Plus className="size-4" />
            {tr("feedback.promote")}
          </Button>
        </div>
      )}

      {feedback.status === "accepted" && (
        <div className="border-border flex flex-wrap justify-end gap-2 border-t p-3">
          <Button variant="ghost" onClick={handleDelete} disabled={busy}>
            {tr("feedback.delete")}
          </Button>
          <Button onClick={handlePromote} disabled={busy}>
            <Plus className="size-4" />
            {tr("feedback.createQuest")}
          </Button>
        </div>
      )}

      {feedback.status === "rejected" && (
        <div className="border-border flex justify-end gap-2 border-t p-3">
          <Button variant="ghost" onClick={handleDelete} disabled={busy}>
            {tr("feedback.delete")}
          </Button>
        </div>
      )}

      <Sheet open={questCreateOpen} onOpenChange={setQuestCreateOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{tr("feedback.createQuest")}</SheetTitle>
          </SheetHeader>
          <QuestCreate
            project={project}
            quest={{
              title: feedback.title,
              description: feedback.description,
              feedbackId: feedback.id,
            }}
            onSubmit={handleQuestCreated}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ProjectFeedbackDetail;
