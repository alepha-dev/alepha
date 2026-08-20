import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  FileText,
  History,
  Hourglass,
  Link2,
  ListChecks,
  Paperclip,
  Pencil,
  ScrollText,
  Settings as SettingsIcon,
  Signature,
  SquareCheck,
  Swords,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentQuestAtom } from "@/web/app/atoms/currentQuestAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import AttachmentBadge from "./AttachmentBadge.tsx";
import QuestCompletionDialog from "./QuestCompletionDialog.tsx";
import QuestDescription from "./QuestDescription.tsx";
import QuestDifficulty from "./QuestDifficulty.tsx";
import QuestHistory from "./QuestHistory.tsx";
import QuestSummaryEditDialog from "./QuestSummaryEditDialog.tsx";
import QuestViewCollapsibleBlock from "./QuestViewCollapsibleBlock.tsx";
import QuestViewDuplicateButton from "./QuestViewDuplicateButton.tsx";
import QuestViewEditButton from "./QuestViewEditButton.tsx";
import QuestViewObjectives from "./QuestViewObjectives.tsx";
import QuestViewSettings from "./QuestViewSettings.tsx";
import QuestViewTimer from "./QuestViewTimer.tsx";
import { formatEstimate } from "./questEstimate.ts";

export interface QuestViewProps {
  quest: QuestResource;
  onClose?: () => void;
  onQuestChange?: (quest: QuestResource) => void;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
}

/** Mirror of ProjectQuestsTable.getPriorityColor — kept local so the
 *  sticky header doesn't have to import board internals. */
const getPriorityColor = (priority: string): string => {
  switch (priority) {
    case "high":
      return "bg-red-500/15 text-red-600";
    case "medium":
      return "bg-orange-500/15 text-orange-600";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const SectionHeader = (props: SectionHeaderProps) => (
  <div className="flex items-center gap-2 px-1 py-1">
    {/* Mirrors QuestViewCollapsibleBlock's header — same paddings,
        icon/label color, and divider — minus the chevron and the
        clickable hover state. Keeping them visually aligned makes
        collapsible vs. static sections feel like one family. */}
    <span className="text-muted-foreground shrink-0">{props.icon}</span>
    <span className="text-muted-foreground text-lg font-bold whitespace-nowrap">
      {props.label}
    </span>
    <div className="bg-border h-px flex-1 opacity-40" />
  </div>
);

const QuestView = (props: QuestViewProps) => {
  const alepha = useAlepha();
  const questApi = useClient<QuestController>();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const dt = useInject(DateTimeProvider);
  const [showDialog, setShowDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showEditSummary, setShowEditSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [quest, setQuest] = useState<QuestResource>(props.quest);
  const [questline, setQuestline] = useState<{
    predecessor?: {
      id: number;
      shortId: number;
      title: string;
      completedAt?: string;
      shelvedAt?: string;
    };
    dependents: Array<{
      id: number;
      shortId: number;
      title: string;
      completedAt?: string;
      shelvedAt?: string;
    }>;
  }>({ dependents: [] });

  useEffect(() => {
    setQuest(props.quest);
  }, [props.quest]);

  // Pull predecessor + dependents whenever the quest identity flips
  // (route change or duplicate spawn). Cheap — at most a few rows.
  useEffect(() => {
    let alive = true;
    questApi
      .getQuestLine({ params: { id: quest.id } })
      .then((data) => {
        if (alive) setQuestline(data);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [quest.id]);

  const [project] = useStore(currentProjectAtom);

  // Per-quest feature toggles live on the project. Undefined → off
  // (the new toggles default off for old projects until the owner
  // opts in via Settings → Quests).
  const questEstimateEnabled = project?.features?.questEstimate === true;
  const questReminderEnabled = project?.features?.questReminder === true;
  const questChronoEnabled = project?.features?.questChrono === true;

  const updateQuest = (updated: QuestResource) => {
    setQuest(updated);
    props.onQuestChange?.(updated);
  };

  const handleClose = () => {
    if (props.onClose) {
      props.onClose();
    } else if (project) {
      router.push("projectQuests", { meta: { deleted: true } });
    }
  };

  const abandonQuest = {
    disabled: !questApi.abandonQuest.can(),
    onClick: async () => {
      const ok = await dialog.confirm({
        title: tr("quest.view.abandon.title"),
        description: tr("quest.view.abandon.confirm"),
        confirmLabel: tr("quest.view.abandon.confirmButton"),
        cancelLabel: tr("common.cancel"),
        destructive: true,
      });
      if (!ok) return;

      const updatedQuest = await questApi.abandonQuest({
        params: { id: quest.id },
      });
      updateQuest(updatedQuest);
      alepha.store.set(
        currentAssignedQuestsAtom,
        (alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
          (t) => t.id !== quest.id,
        ),
      );
      handleClose();
    },
  };

  const shelveQuest = {
    disabled: !questApi.shelveQuest.can(),
    onClick: async () => {
      // Shelving a quest others depend on leaves them blocked with no
      // path forward — call that out before it happens rather than
      // letting the dependent quietly stall.
      const blocked = questline.dependents.filter((d) => !d.completedAt);
      const ok = await dialog.confirm({
        title: tr("quest.view.shelve.title"),
        description: blocked.length
          ? tr("quest.view.shelve.confirmWithDependents", {
              args: [blocked.map((d) => `#${d.shortId}`).join(", ")],
            })
          : tr("quest.view.shelve.confirm"),
        confirmLabel: tr("quest.view.shelve.confirmButton"),
        cancelLabel: tr("common.cancel"),
      });
      if (!ok) return;

      const updatedQuest = await questApi.shelveQuest({
        params: { id: quest.id },
      });
      updateQuest(updatedQuest);
      alepha.store.set(currentQuestAtom, updatedQuest);
    },
  };

  const unshelveQuest = {
    disabled: !questApi.unshelveQuest.can(),
    onClick: async () => {
      const updatedQuest = await questApi.unshelveQuest({
        params: { id: quest.id },
      });
      updateQuest(updatedQuest);
      alepha.store.set(currentQuestAtom, updatedQuest);
    },
  };

  return (
    // The quest sits directly on the page surface — no card, no border, no
    // radius, no margin. `bg-background` is what the AppShell's content panel
    // already paints, so the route context matches seamlessly; in the kanban
    // drawer it covers the Sheet's `bg-popover` instead, which keeps the two
    // contexts looking like the same view rather than two surfaces.
    <div
      key={quest.id}
      className="bg-background flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="flex flex-1 flex-col gap-6 px-5 py-4">
          {/* Sticky header — stays visible as the quest body scrolls.
              Works in both contexts: the route page and the kanban
              drawer share this same scroll container.
              `-mx-5 -mt-4` cancels the parent's padding so the header
              spans the full width and sits flush with the top edge.
              Carries title (prefixed with #shortId), priority + difficulty
              badges, the edit/duplicate/timer/close affordances. The old prose
              "priority · rank" summary line is absorbed into the badges. */}
          <header className="bg-background border-border sticky top-0 z-10 -mx-5 -mt-4 flex items-center gap-3 border-b px-5 py-3">
            {/* The rank box is the only leading glyph: #shortId reads as part
                of the quest's name, so it moved into the title, and the Tag
                icon that anchored the pair went with it. Alone in an
                `items-center` row the box is vertically centered against the
                title column — stacked under #shortId it never was. */}
            <QuestDifficulty difficulty={quest.difficulty} />

            {/* Title column: title + tag chips stacked, takes remaining
                width. leading-tight compresses the title so the chips sit
                close underneath instead of orphaning a half-line gap. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="cinzel-400 truncate text-lg leading-tight font-bold">
                <span className="text-muted-foreground font-mono text-sm">
                  #{quest.shortId}
                </span>{" "}
                {quest.title}
              </span>
              {quest.tags && quest.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {quest.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={router.path("projectQuests", {
                        params: { projectSlug: project?.slug ?? "" },
                        query: { tag },
                      })}
                      className="bg-muted hover:bg-muted/70 rounded-sm border px-1.5 py-0.5 font-mono text-xs leading-none"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {questEstimateEnabled && quest.estimateMinutes != null && (
              <Badge
                variant="secondary"
                className="text-muted-foreground shrink-0 gap-1"
                title={tr("quest.item.estimate")}
              >
                <Hourglass className="size-3" />~
                {formatEstimate(quest.estimateMinutes)}
              </Badge>
            )}

            <Badge
              variant="secondary"
              className={`${getPriorityColor(quest.priority)} shrink-0`}
            >
              {quest.priority}
            </Badge>

            {quest.shelvedAt && (
              <Badge
                variant="secondary"
                className="text-muted-foreground shrink-0"
              >
                <Archive className="size-3" />
                {tr("quest.status.shelved")}
              </Badge>
            )}

            {/* Action cluster — tight gap-0.5 so edit/dup/timer read as
                one unit instead of three drifting items. */}
            {((!quest.completedAt && project) || questChronoEnabled) && (
              <div className="flex shrink-0 items-center gap-0.5">
                {!quest.completedAt && project && (
                  <>
                    <QuestViewEditButton
                      quest={quest}
                      onUpdate={(it) => {
                        updateQuest(it);
                        alepha.store.set(currentQuestAtom, it);
                      }}
                      showDialog={showDialog}
                      setShowDialog={setShowDialog}
                    />
                    {/* Reminder moved into the Settings block at the
                        bottom of the view (Lore quest #42). */}
                    <QuestViewDuplicateButton quest={quest} />
                  </>
                )}
                {questChronoEnabled && (
                  <QuestViewTimer
                    quest={quest}
                    onUpdate={(it) => {
                      updateQuest(it);
                      alepha.store.set(currentQuestAtom, it);
                      const quests =
                        alepha.store.get(currentAssignedQuestsAtom) ?? [];
                      alepha.store.set(
                        currentAssignedQuestsAtom,
                        quests.map((t) => (t.id === it.id ? it : t)),
                      );
                    }}
                  />
                )}
              </div>
            )}

            {/* Visible 1px divider before the close button — reads as
                intentional structure, not an arbitrary ml-4 gap. */}
            {(props.onClose || project) && (
              <div className="bg-border h-6 w-px shrink-0" />
            )}
            {props.onClose ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 shrink-0 p-0"
                onClick={props.onClose}
              >
                <X className="size-4" />
              </Button>
            ) : project ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 shrink-0 p-0"
                render={
                  <Link
                    href={router.path("projectQuests", {
                      params: { projectSlug: project.slug },
                    })}
                  />
                }
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </header>

          {/* Questline (Lore #32) — predecessor + dependents.
              Blocked-by flips to Unblocked once the predecessor closes;
              dependents are surfaced as a backlink list. */}
          {(questline.predecessor || questline.dependents.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
              {questline.predecessor && (
                <Link
                  href={router.path("projectQuestGraph", {
                    params: {
                      projectSlug: project?.slug ?? "",
                      shortId: String(quest.shortId),
                    },
                  })}
                  className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 ${
                    questline.predecessor.completedAt
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-600"
                  }`}
                >
                  {questline.predecessor.completedAt ? (
                    <SquareCheck className="size-3" />
                  ) : (
                    <Link2 className="size-3" />
                  )}
                  {questline.predecessor.completedAt
                    ? tr("quest.view.questline.unblocked", {
                        args: [String(questline.predecessor.shortId)],
                      })
                    : questline.predecessor.shelvedAt
                      ? // A shelved predecessor never completes on its own,
                        // so say so rather than implying the block will
                        // clear by itself.
                        tr("quest.view.questline.blockedByShelved", {
                          args: [String(questline.predecessor.shortId)],
                        })
                      : tr("quest.view.questline.blockedBy", {
                          args: [String(questline.predecessor.shortId)],
                        })}
                  <span className="text-muted-foreground">
                    {questline.predecessor.title}
                  </span>
                </Link>
              )}
              {questline.dependents.map((dep) => (
                <Link
                  key={dep.id}
                  href={router.path("projectQuestGraph", {
                    params: {
                      projectSlug: project?.slug ?? "",
                      shortId: String(quest.shortId),
                    },
                  })}
                  className="bg-muted hover:bg-muted/70 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5"
                >
                  <Link2 className="size-3 rotate-90" />
                  {tr("quest.view.questline.unlocks", {
                    args: [String(dep.shortId)],
                  })}
                  <span className="text-muted-foreground">{dep.title}</span>
                </Link>
              ))}
            </div>
          )}

          {/* Description (collapsible, default expanded) */}
          <QuestViewCollapsibleBlock
            icon={<FileText className="size-5" />}
            label={tr("quest.view.description")}
            defaultOpen
          >
            <QuestDescription
              quest={quest}
              onEdit={() => setShowDialog(true)}
            />
          </QuestViewCollapsibleBlock>

          {/* Completion summary — visible on completed quests. Owners /
              creators (the only allowed editors server-side) can amend
              the message; the data model carries an `editedAt` stamp so
              the UI can surface "edited X ago" honestly. */}
          {quest.completedAt && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <SectionHeader
                  icon={<ScrollText className="size-5" />}
                  label={tr("quest.view.completionSummary")}
                />
                {questApi.updateQuestById.can() && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={tr("quest.view.editSummary.title")}
                    onClick={() => setShowEditSummary(true)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
              </div>
              {quest.completionMessage ? (
                <div className="bg-muted border-border flex flex-col gap-2 rounded-md border p-3 px-4">
                  <MarkdownView content={quest.completionMessage} />
                  {quest.completionMessageUpdatedAt &&
                    quest.completedAt &&
                    quest.completionMessageUpdatedAt !== quest.completedAt && (
                      <span className="text-muted-foreground text-xs italic">
                        {tr("quest.view.completionSummary.edited", {
                          args: [
                            dt.of(quest.completionMessageUpdatedAt).fromNow(),
                          ],
                        })}
                      </span>
                    )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowEditSummary(true)}
                  className="bg-muted border-border text-muted-foreground rounded-md border p-3 px-4 text-left text-sm italic hover:underline"
                >
                  {tr("quest.view.completionSummary.empty")}
                </button>
              )}
            </div>
          )}

          {/* Objectives (collapsible, default expanded) */}
          {quest.objectives.length > 0 && (
            <QuestViewCollapsibleBlock
              icon={<ListChecks className="size-5" />}
              label={tr("quest.view.objectives")}
              defaultOpen
            >
              <QuestViewObjectives
                quest={quest}
                onQuestUpdate={(updatedQuest) => {
                  updateQuest(updatedQuest);
                  alepha.store.set(currentQuestAtom, updatedQuest);
                }}
              />
            </QuestViewCollapsibleBlock>
          )}

          {/* Attachments — kept non-collapsible; only shown when present */}
          {quest.attachments && quest.attachments.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionHeader
                icon={<Paperclip className="size-5" />}
                label={tr("quest.view.attachments")}
              />
              <div className="flex flex-wrap gap-2">
                {quest.attachments.map((fileId) => (
                  <AttachmentBadge key={fileId} fileId={fileId} disabled />
                ))}
              </div>
            </div>
          )}

          {/* History (collapsible, default collapsed) */}
          <QuestViewCollapsibleBlock
            icon={<History className="size-5" />}
            label={tr("quest.view.history")}
          >
            <QuestHistory quest={quest} />
          </QuestViewCollapsibleBlock>

          {/* Settings — Reminder lives here. Hidden when the per-project
              Quest Reminder toggle is off. */}
          {questReminderEnabled && !quest.completedAt && (
            <QuestViewCollapsibleBlock
              icon={<SettingsIcon className="size-5" />}
              label={tr("quest.view.settings")}
            >
              <QuestViewSettings
                quest={quest}
                onUpdate={(it) => {
                  updateQuest(it);
                  alepha.store.set(currentQuestAtom, it);
                }}
              />
            </QuestViewCollapsibleBlock>
          )}
        </div>

        {!quest.completedAt && (
          <div className="bg-muted border-border sticky bottom-0 z-10 -mx-5 -mb-4 border-t px-8 py-3">
            {!quest.acceptedAt && (
              <div className="flex items-center justify-between gap-2">
                {/* Shelve sits opposite Accept: both are ways of answering
                    "am I doing this?", so they belong on the same bar. */}
                {quest.shelvedAt ? (
                  <Button type="button" variant="outline" {...unshelveQuest}>
                    <ArchiveRestore className="size-4" />
                    <span className="hidden sm:inline">
                      {tr("quest.view.actions.unshelve")}
                    </span>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" {...shelveQuest}>
                    <Archive className="size-4" />
                    <span className="hidden sm:inline">
                      {tr("quest.view.actions.shelve")}
                    </span>
                  </Button>
                )}
                <Button
                  type="button"
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={!questApi.acceptQuest.can()}
                  onClick={async () => {
                    const updatedQuest = await questApi.acceptQuest({
                      params: { id: quest.id },
                    });
                    updateQuest(updatedQuest);
                    alepha.store.set(currentQuestAtom, updatedQuest);
                    alepha.store.set(currentAssignedQuestsAtom, [
                      ...(alepha.store.get(currentAssignedQuestsAtom) ?? []),
                      updatedQuest,
                    ]);
                  }}
                >
                  <Signature className="size-4" />
                  {tr("quest.view.actions.accept")}
                </Button>
              </div>
            )}
            {quest.acceptedAt && (
              <div className="flex justify-between gap-2">
                <Button type="button" variant="destructive" {...abandonQuest}>
                  <Trash2 className="size-4" />
                  <span className="hidden sm:inline">
                    {tr("quest.view.actions.abandon")}
                  </span>
                </Button>
                <Button
                  type="button"
                  className="bg-green-600 text-white hover:bg-green-700"
                  disabled={
                    !questApi.completeQuest.can() ||
                    quest.objectives.some((o) => !o.completed)
                  }
                  onClick={() => setShowCompleteDialog(true)}
                >
                  <Swords className="size-4" />
                  {tr("quest.view.actions.complete")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <QuestSummaryEditDialog
        open={showEditSummary}
        onOpenChange={(open) => {
          if (!savingSummary) setShowEditSummary(open);
        }}
        initialValue={quest.completionMessage}
        submitting={savingSummary}
        onSave={async (message) => {
          setSavingSummary(true);
          try {
            const updated = await questApi.updateQuestById({
              params: { id: quest.id },
              body: { completionMessage: message },
            });
            updateQuest(updated);
            alepha.store.set(currentQuestAtom, updated);
            setShowEditSummary(false);
          } finally {
            setSavingSummary(false);
          }
        }}
      />
      <QuestCompletionDialog
        open={showCompleteDialog}
        onOpenChange={(open) => {
          if (!completing) setShowCompleteDialog(open);
        }}
        submitting={completing}
        onConfirm={async (message) => {
          setCompleting(true);
          try {
            const updatedQuest = await questApi.completeQuest({
              params: { id: quest.id },
              body: { message },
            });
            updateQuest(updatedQuest);
            alepha.store.set(
              currentAssignedQuestsAtom,
              (alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
                (t) => t.id !== quest.id,
              ),
            );
            setShowCompleteDialog(false);
            handleClose();
          } finally {
            setCompleting(false);
          }
        }}
      />
    </div>
  );
};

export default QuestView;
