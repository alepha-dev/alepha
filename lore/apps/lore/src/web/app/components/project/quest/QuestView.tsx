import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  FileText,
  History,
  Hourglass,
  Link2,
  ListChecks,
  MoreHorizontal,
  Paperclip,
  Pencil,
  ScrollText,
  Settings as SettingsIcon,
  Signature,
  SquareCheck,
  Swords,
  Trash2,
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
  /**
   * Which mount this is. `page` is the quest route at
   * `/:projectSlug/quests/:shortId`; `card` is the same component inside the
   * kanban board's sheet, at half the width.
   *
   * It chooses which sections render inline and which fold behind the
   * header's overflow menu — see {@link FOLDABLE_SECTIONS}. Defaults to
   * `page` because the route loader hands this component its props and has
   * nowhere to pass a context; only the card mount is explicit.
   */
  context?: QuestViewContext;
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
        icon/label face, and hairline rule — minus the chevron and the
        clickable hover state. Keeping them visually aligned makes
        collapsible vs. static sections feel like one family. */}
    <span className="text-muted-foreground shrink-0 [&>svg]:size-4">
      {props.icon}
    </span>
    <span className="text-muted-foreground text-xs font-semibold tracking-[0.84px] whitespace-nowrap uppercase">
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

  const context: QuestViewContext = props.context ?? "page";

  // Sections the card mount folds away, until the reader asks for one from
  // the overflow menu. Revealing is per-mount and deliberately not
  // remembered: a card back is opened to read the quest, not to resume a
  // layout.
  const [revealed, setRevealed] = useState<QuestViewSection[]>([]);
  const rendersInline = (section: QuestViewSection) =>
    context === "page" ||
    !FOLDABLE_SECTIONS.includes(section) ||
    revealed.includes(section);

  // A folded section only earns a menu entry when it would have something to
  // show — an overflow listing "Completion summary" on an unfinished quest is
  // a dead entry.
  const foldedSections = FOLDABLE_SECTIONS.filter(
    (section) =>
      !rendersInline(section) &&
      (section === "completionSummary"
        ? !!quest.completedAt
        : questReminderEnabled && !quest.completedAt),
  );

  const updateQuest = (updated: QuestResource) => {
    setQuest(updated);
    props.onQuestChange?.(updated);
  };

  /**
   * Leave the quest because it is no longer the thing being worked on.
   *
   * Unassign uses this and pushes rather than going back on purpose: the
   * list it would return to still shows this quest as assigned.
   */
  const handleClose = () => {
    if (props.onClose) {
      props.onClose();
    } else if (project) {
      router.push("projectQuests", { meta: { deleted: true } });
    }
  };

  /**
   * The header arrow. The breadcrumb walks *up*; this walks *back*.
   *
   * On the card mount closing the sheet is the back: the board is still
   * behind it, and pushing a route would navigate the page out from under
   * the board. On the page mount `canGoBack` is read here rather than during
   * render — this component renders on the server too, where there is no
   * history — and falls back to the quest list for a deep link, a refresh,
   * or an arrival from outside.
   */
  const handleBack = () => {
    if (props.onClose) {
      props.onClose();
      return;
    }
    if (router.canGoBack) {
      void router.back();
      return;
    }
    if (project) {
      router.push("projectQuests", {
        params: { projectSlug: project.slug },
      });
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
              Carries the back arrow, the title (prefixed with #shortId),
              the priority badge and the edit/duplicate/timer affordances. */}
          <header className="bg-background border-border sticky top-0 z-10 -mx-5 -mt-4 flex items-center gap-3 border-b px-5 py-3">
            {/* The arrow leads the header on both mounts. It replaces the
                close cross that used to sit on the right: a cross says "this
                is a dialog", and on the route page it was not one. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0"
              aria-label={tr("quest.view.back")}
              onClick={handleBack}
            >
              <ArrowLeft className="size-4" />
            </Button>

            {/* Title column: title + tag chips stacked, takes remaining
                width. leading-tight compresses the title so the chips sit
                close underneath instead of orphaning a half-line gap. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Inter, not Cinzel: the RPG surface is vocabulary, not
                  lettering. The page mount takes the mockup's 30px/600; the
                  card back stays at 18px, where 30px would eat a half-width
                  sheet. */}
              <span
                className={`truncate leading-tight font-semibold ${
                  context === "page"
                    ? "text-3xl tracking-[-0.6px]"
                    : "text-lg font-bold"
                }`}
              >
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

            {/* Overflow — the way back to a section this mount folded
                away. Only rendered when it would have an entry, so the page
                mount (which folds nothing) never shows an empty menu. */}
            {foldedSections.length > 0 && (
              <>
                <div className="bg-border h-6 w-px shrink-0" />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 p-0"
                        aria-label={tr("quest.view.more")}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {foldedSections.map((section) => (
                      <DropdownMenuItem
                        key={section}
                        onClick={() =>
                          setRevealed((prev) => [...prev, section])
                        }
                      >
                        {section === "completionSummary" ? (
                          <ScrollText className="size-4" />
                        ) : (
                          <SettingsIcon className="size-4" />
                        )}
                        {section === "completionSummary"
                          ? tr("quest.view.completionSummary")
                          : tr("quest.view.settings")}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
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
          {quest.completedAt && rendersInline("completionSummary") && (
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
          {questReminderEnabled &&
            !quest.completedAt &&
            rendersInline("settings") && (
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
            alepha.store.set(currentQuestAtom, updatedQuest);
            alepha.store.set(
              currentAssignedQuestsAtom,
              (alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
                (t) => t.id !== quest.id,
              ),
            );
            setShowCompleteDialog(false);
            // The page mount STAYS. Completing used to push back to the
            // list, which threw away the summary that was just written —
            // the one moment the reader most wants to see it rendered. The
            // card mount still closes: the board behind it is the thing
            // being worked, and its column has already been updated through
            // `onQuestChange`.
            props.onClose?.();
          } finally {
            setCompleting(false);
          }
        }}
      />
    </div>
  );
};

/**
 * Which mount `QuestView` is rendering as.
 *
 * One component, two mounts: `AppRouter`'s `projectQuest` lazy-loads this
 * exact file, and the kanban board mounts it inside a `Sheet`. Every change
 * here therefore pays twice, which is why this is a prop over a fork.
 */
export type QuestViewContext = "page" | "card";

/**
 * Sections that can fold behind the header's overflow menu.
 *
 * Only the card mount folds them: at half the viewport width, the completion
 * summary and the reminder controls push the description and the objectives
 * (what a card back is opened for) below the fold. On the page there is room
 * for everything, so nothing folds and the overflow never renders.
 */
export type QuestViewSection = "completionSummary" | "settings";

const FOLDABLE_SECTIONS: QuestViewSection[] = ["completionSummary", "settings"];

export default QuestView;
