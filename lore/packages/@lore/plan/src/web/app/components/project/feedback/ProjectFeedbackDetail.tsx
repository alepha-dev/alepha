import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useDialog,
  useToast,
} from "@alepha/ui";
import {
  currentProjectAtom,
  type I18n,
  capabilityOption,
  formatReference,
  useRank,
  AgentPromptsMenu,
  CollapsibleBlock,
  DiscussionAttachments,
} from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import {
  Circle,
  CircleCheck,
  CircleX,
  FileText,
  Info,
  Link2,
  MessageSquare,
  Paperclip,
  Plus,
} from "lucide-react";
import { Fragment, useState } from "react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";
import { useWorkPromptSubject } from "../prompts/useWorkPromptSubject.ts";
import {
  QUEST_STATUS_ICON,
  QUEST_STATUS_LABEL_KEYS,
  QUEST_STATUS_TONE,
} from "../quest/questChips.ts";
import QuestCreate from "../quest/QuestCreate.tsx";
import {
  FeedbackAgentJobLink,
  useFeedbackAgentTriage,
} from "./FeedbackAgentTriage.tsx";
import FeedbackThread from "./FeedbackThread.tsx";
import FeedbackTrailList from "./FeedbackTrailList.tsx";

export interface ProjectFeedbackDetailProps {
  feedback: FeedbackResource;
  onChanged: () => void;
  onBack?: () => void;
}

/**
 * The status chip's tone: waiting, taken, turned down.
 */
const STATUS_TONE = {
  pending: "warning",
  accepted: "success",
  rejected: "danger",
} as const;

/**
 * The status chip's glyph: the same three the list's Segmented filter and
 * its rows carry.
 */
const STATUS_ICON = {
  pending: Circle,
  accepted: CircleCheck,
  rejected: CircleX,
} as const;

const ProjectFeedbackDetail = (props: ProjectFeedbackDetailProps) => {
  const { feedback } = props;
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [currentUser] = useStore(currentUserAtom);
  const { can } = useRank();
  const promptSubject = useWorkPromptSubject();
  // Stated here rather than left to the route guard. The panel is a
  // component and a spec can mount it directly, so a gate that only exists
  // upstream is a gate this component does not have.
  const supportEnabled = capabilityOption(project, "plan", "feedback");

  /**
   * What the robot menu offers, in all three footers.
   *
   * ⚠️ **The loop is here rather than on the inbox toolbar** (feedback
   * #P2176, reversing #Q2153). It was put on the toolbar on the reasoning
   * that a loop is not an action on the open report and would be invisible
   * with nothing selected - and the second half was simply wrong:
   * `ProjectFeedback` seeds `activeId` from the first item, so a non-empty
   * list always has one open. An inbox with nothing selected is an EMPTY
   * inbox, which is the one state where a loop has nothing to do. What the
   * toolbar actually produced was two robot buttons on one page.
   *
   * `feedbackLoop` is offered whatever the open item's status, because it is
   * about the queue and not about that item; `feedbackWork` only where there
   * is something to work on, which a rejected report is not.
   */
  const promptItems = supportEnabled
    ? [
        ...(feedback.status === "rejected"
          ? []
          : [
              {
                kind: "feedbackWork" as const,
                subject: () => promptSubject.forFeedback(feedback),
              },
            ]),
        {
          // Still surface-scoped: the loop names the inbox, never the item
          // whose footer it happens to be drawn in, so it must not carry
          // that item's `{{reference}}`.
          kind: "feedbackLoop" as const,
          subject: () => promptSubject.forFeedbackInbox(),
        },
      ]
    : [];
  // Triage with Claude, run on the Agent host (#Q4126): entries of the same
  // robot menu, offered only while that host's agent check passes.
  const agentActions = useFeedbackAgentTriage(feedback, props.onChanged);
  const feedbackApi = useClient<FeedbackController>();
  const router = useRouter();
  const toaster = useToast();
  const dialog = useDialog();

  const [questCreateOpen, setQuestCreateOpen] = useState(false);
  // One `useAction` per triage verb (#E59, #Q2328). A refusal is the server's
  // sentence, toasted by the root `ActionErrorToaster`; the translated
  // fallbacks it used to sit behind never fired, and left the catalogs.
  const promoteAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        if (feedback.status === "pending") {
          await feedbackApi.acceptFeedback({
            params: { projectId: project.id, feedbackId: feedback.id },
          });
          toaster.show(tr("feedback.acceptedToast"), "success");
        }
        setQuestCreateOpen(true);
      },
    },
    [feedbackApi, project?.id, feedback.id, feedback.status, toaster, tr],
  );

  const rejectAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        await feedbackApi.rejectFeedback({
          params: { projectId: project.id, feedbackId: feedback.id },
        });
        toaster.show(tr("feedback.rejected"), "success");
        props.onChanged();
      },
    },
    [feedbackApi, project?.id, feedback.id, props.onChanged, toaster, tr],
  );

  const deleteAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        const confirmed = await dialog.confirm({
          title: tr("feedback.deleteConfirmTitle"),
          description: tr("feedback.deleteConfirm"),
        });
        if (!confirmed) return;
        await feedbackApi.removeFeedback({
          params: { projectId: project.id, feedbackId: feedback.id },
        });
        toaster.show(tr("feedback.deleted"), "success");
        props.onChanged();
      },
    },
    [
      feedbackApi,
      project?.id,
      feedback.id,
      dialog,
      props.onChanged,
      toaster,
      tr,
    ],
  );

  const busy =
    promoteAction.loading || rejectAction.loading || deleteAction.loading;
  const handlePromote = () => void promoteAction.run();
  const handleReject = () => void rejectAction.run();
  const handleDelete = () => void deleteAction.run();

  if (!project) return null;

  const handleQuestCreated = () => {
    setQuestSheetOpen(false);
  };

  /**
   * Accepting is the first half of promoting, and it is already committed
   * by the time this sheet opens - so the list has to be told when the
   * sheet goes away, whichever way it goes away.
   *
   * `onChanged` cannot be called at accept time: it refetches the list and
   * moves the selection to the next pending item, which would swap this
   * pane, and the open sheet with it, out from under the user mid-flow. So
   * the notification waits here, at the one point where nothing is left to
   * interrupt. Before this, only the create-a-quest path notified: accept
   * then dismiss left the row reading `pending` against a feedback the
   * server had already triaged, and pressing Accept again answered
   * "already triaged".
   */
  const setQuestSheetOpen = (open: boolean) => {
    setQuestCreateOpen(open);
    if (!open) props.onChanged();
  };

  const linkedQuests = feedback.linkedQuests ?? [];
  // `feedback` is the tag the request form used to add to every untagged
  // item. It said nothing, the form no longer adds it, and the items saved
  // before still carry it: left out here rather than rewritten in the rows.
  const tags = (feedback.tags ?? []).filter((tag) => tag !== "feedback");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border chrome flex h-14 shrink-0 items-center gap-3 border-b px-4">
        {props.onBack && (
          <Button
            variant="minimal"
            size="sm"
            onClick={props.onBack}
            className="md:hidden"
          >
            {tr("feedback.back")}
          </Button>
        )}
        {/* `#P120 - Title`, the shape a quest's and an epic's titles have
            (#Q3574): the number in the title's own colour, the separator
            muted, truncated with the whole line in the tooltip. */}
        <h2
          className="min-w-0 flex-1 truncate text-base font-semibold"
          title={`${formatReference("feedback", feedback.shortId)} - ${feedback.title}`}
          data-testid="feedback-detail-title"
        >
          {formatReference("feedback", feedback.shortId)}{" "}
          <span className="text-muted-foreground">-</span> {feedback.title}
        </h2>
        {/* A tint chip, so it reads as a tag on the chrome band. */}
        <Badge
          variant="tint"
          tone={STATUS_TONE[feedback.status]}
          className="shrink-0 gap-1 uppercase"
        >
          {(() => {
            const Icon = STATUS_ICON[feedback.status];
            return <Icon className="size-3 shrink-0" aria-hidden="true" />;
          })()}
          {tr(`feedback.filter.${feedback.status}`)}
        </Badge>
        {/* Written outside the team (#Q3987): no agent works on it while
            the Agent host runs jobs as a process. */}
        {feedback.untrusted && (
          <Badge
            variant="tint"
            tone="warning"
            className="shrink-0 uppercase"
            title={tr("feedback.untrusted.description")}
            data-testid="feedback-untrusted"
          >
            {tr("feedback.untrusted")}
          </Badge>
        )}
        <FeedbackAgentJobLink feedback={feedback} />
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Collapsible blocks, as on the quest page. */}
        <CollapsibleBlock
          icon={<FileText className="size-5" />}
          label={tr("feedback.description")}
          defaultOpen
        >
          <p className="text-sm whitespace-pre-wrap">{feedback.description}</p>
        </CollapsibleBlock>

        {feedback.attachmentUrls && feedback.attachmentUrls.length > 0 && (
          <CollapsibleBlock
            icon={<Paperclip className="size-5" />}
            label={tr("feedback.attachments")}
            defaultOpen
            aside={
              <span className="text-muted-foreground shrink-0 text-xs">
                {feedback.attachmentUrls.length}
              </span>
            }
          >
            {/* The discussion's tiles (#Q4008): an image is its own
                thumbnail and zooms in the lightbox, any other file is a
                tile with its name and size that opens in a tab. The quest
                view's comments draw files the same way. */}
            <DiscussionAttachments items={feedback.attachmentUrls} />
          </CollapsibleBlock>
        )}

        {feedback.status === "accepted" && (
          <CollapsibleBlock
            icon={<Link2 className="size-5" />}
            label={tr("feedback.linkedQuests")}
            defaultOpen
            aside={
              linkedQuests.length > 0 ? (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {linkedQuests.length}
                </span>
              ) : undefined
            }
          >
            <div data-testid="feedback-linked-quests">
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
                        className="bg-muted/30 hover:bg-hover border-border flex items-center gap-2 rounded border px-3 py-2 text-sm"
                        data-testid={`linked-quest-${q.id}`}
                      >
                        {/* The quest's typed reference, not the
                          `ExternalLink` icon it used to carry: that icon
                          means "this leaves Lore" everywhere else
                          (#Q2222), and a quest is an in-app route. */}
                        <span className="text-muted-foreground font-mono text-xs">
                          {formatReference("quest", q.shortId)}
                        </span>
                        <span className="flex-1 truncate">{q.title}</span>
                        {/* The shared tint chip, as the feedback status
                          above wears it (#Q4195): its text follows the
                          theme, where hand-picked `-300` shades washed out
                          on light. */}
                        <Badge
                          variant="tint"
                          tone={QUEST_STATUS_TONE[q.status]}
                          className="shrink-0 gap-1 uppercase"
                          data-testid={`linked-quest-status-${q.id}`}
                        >
                          {(() => {
                            const Icon = QUEST_STATUS_ICON[q.status];
                            return (
                              <Icon
                                className="size-3 shrink-0"
                                aria-hidden="true"
                              />
                            );
                          })()}
                          {tr(QUEST_STATUS_LABEL_KEYS[q.status])}
                        </Badge>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CollapsibleBlock>
        )}

        {(tags.length > 0 || feedback.reporter || feedback.source) && (
          <CollapsibleBlock
            icon={<Info className="size-5" />}
            label={tr("feedback.context.title")}
            defaultOpen
          >
            {/* On a wide pane (`@2xl`, a container query: the pane, not the
                window, is what has room) three columns: the facts, the
                pages visited and the actions; one column otherwise. The
                trail's sections are cells of this grid. */}
            <div className="@container">
              <div className="grid gap-4 @2xl:grid-cols-3">
                {/* Provenance fields are attacker-controlled: rendered as escaped
                    plain text only (never as links/markdown). See folio #12. */}
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                  {/* The tags (the kind, `bug` or `feature`, and any other) are
                      one more fact about the item, so they are plain text with
                      the others, not chips on a line above the description. */}
                  {tags.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">
                        {tr("feedback.context.tags")}
                      </dt>
                      <dd data-testid="feedback-tags">{tags.join(", ")}</dd>
                    </>
                  )}
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
                        [
                          "feedback.context.userAgent",
                          feedback.source.userAgent,
                        ],
                        ["feedback.context.language", feedback.source.language],
                        ["feedback.context.viewport", feedback.source.viewport],
                        ["feedback.context.screen", feedback.source.screen],
                        ["feedback.context.timezone", feedback.source.timezone],
                      ] as const
                    )
                      .filter(([, value]) => !!value)
                      .map(([labelKey, value]) => (
                        <Fragment key={labelKey}>
                          <dt className="text-muted-foreground">
                            {tr(labelKey)}
                          </dt>
                          <dd className="break-all">{value}</dd>
                        </Fragment>
                      ))}
                </dl>
                {/* What happened just before (#Q4038), errors first. */}
                {feedback.source?.trail && (
                  <FeedbackTrailList trail={feedback.source.trail} />
                )}
              </div>
            </div>
          </CollapsibleBlock>
        )}

        {/* The thread, under the item's own content: triage findings and
            questions to the reporter used to have nowhere to live but a
            quest that might never be created. */}
        <CollapsibleBlock
          icon={<MessageSquare className="size-5" />}
          label={tr("feedback.thread.title")}
          defaultOpen
        >
          <FeedbackThread
            feedbackId={feedback.id}
            projectId={feedback.projectId}
            reporterUserId={feedback.reporterUserId}
            currentUserId={currentUser?.id}
            isOwner={can("feedback:triage")}
            editor
          />
        </CollapsibleBlock>
      </div>

      {feedback.status === "pending" && (
        <div className="border-border chrome flex flex-wrap justify-start gap-2 border-t p-3">
          {/* ⚠️ Anchored LEFT, and ordered by importance from there, with
              the weight falling off as it goes: filled, outlined, bare,
              icon. Both halves exist for the same reason and neither is
              cosmetic.

              The floating feedback bubble sits in the bottom-right corner
              of the viewport, on top of whatever this row ends with. The
              order came first (feedback #P2150): the row ran primary-last,
              so "Promote to Q…" was the control the bubble clipped. That
              moved the primary out of the corner and left the icon button
              in it (feedback #P2153). Anchoring the row to the left takes
              every control out at once, whatever the last one happens to
              be, which is why `justify-end` must not come back here or on
              the two footers below.

              Delete is the quietest control here and it is the most
              destructive, which is deliberate and safe only because it is
              confirmed by a dialog. It keeps a real label so it does not
              read as the disabled sibling of the icon button beside it.

              Agent Prompts is last and icon-only: the least urgent control
              and, labelled, the widest. Two capabilities, and this reads
              the second only to NARROW what it offers. Support decides
              whether this panel exists at all; the prompt ends in
              `quest_create`, which needs Work, so Work's `agentPrompts`
              option decides whether the entry does. A capability may read
              another's state to do less, never to do more. */}
          <Button
            onClick={handlePromote}
            disabled={busy}
            data-testid="feedback-accept-button"
          >
            <Plus className="size-4" />
            {tr("feedback.promote")}
          </Button>
          <Button variant="outlined" onClick={handleReject} disabled={busy}>
            {tr("feedback.reject")}
          </Button>
          <Button variant="minimal" onClick={handleDelete} disabled={busy}>
            {tr("feedback.delete")}
          </Button>
          <AgentPromptsMenu items={promptItems} actions={agentActions} />
        </div>
      )}

      {feedback.status === "accepted" && (
        <div className="border-border chrome flex flex-wrap justify-start gap-2 border-t p-3">
          {/* Same order as the pending footer above, minus Reject: an
              accepted item has nothing to reject. */}
          <Button onClick={handlePromote} disabled={busy}>
            <Plus className="size-4" />
            {tr("feedback.createQuest")}
          </Button>
          <Button variant="minimal" onClick={handleDelete} disabled={busy}>
            {tr("feedback.delete")}
          </Button>
          <AgentPromptsMenu items={promptItems} actions={agentActions} />
        </div>
      )}

      {feedback.status === "rejected" && (
        <div className="border-border chrome flex justify-start gap-2 border-t p-3">
          <Button variant="minimal" onClick={handleDelete} disabled={busy}>
            {tr("feedback.delete")}
          </Button>
          {/* ⚠️ This footer had no menu at all, and gains one rather than
              being left out. The loop is about the INBOX, not about the item
              open in front of it, so hiding it because the report you happen
              to be looking at was rejected would make the control appear and
              disappear on something unrelated to what it does. `promptItems`
              drops `feedbackWork` here on its own: there is nothing to work
              on in a rejected report. */}
          <AgentPromptsMenu items={promptItems} actions={agentActions} />
        </div>
      )}

      <Sheet open={questCreateOpen} onOpenChange={setQuestSheetOpen}>
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
