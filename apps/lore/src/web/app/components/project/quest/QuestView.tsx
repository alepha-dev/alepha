import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  CircleDot,
  FileText,
  Inbox,
  ListChecks,
  Paperclip,
  Signature,
  Swords,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentEpicsAtom } from "@/web/app/atoms/currentEpicsAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentQuestAtom } from "@/web/app/atoms/currentQuestAtom.ts";
import { useQuestMutations } from "@/web/app/components/shared/useQuestMutations.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import CollapsibleBlock from "../../shared/CollapsibleBlock.tsx";
import { formatReference } from "../../shared/element/typedReference.ts";
import { AgentPromptsMenu } from "../prompts/AgentPromptsMenu.tsx";
import { questAgentGate } from "../prompts/questAgentGate.ts";
import { useAgentPromptSubject } from "../prompts/useAgentPromptSubject.ts";
import QuestAttachments from "./QuestAttachments.tsx";
import { QUEST_STATUS_TONE } from "./questChips.ts";
import QuestCompletionDialog from "./QuestCompletionDialog.tsx";
import QuestDescription from "./QuestDescription.tsx";
import QuestDiscussion from "./QuestDiscussion.tsx";
import { QuestDueDate } from "./questDueDate.ts";
import QuestViewEditButton from "./QuestViewEditButton.tsx";
import QuestViewObjectives from "./QuestViewObjectives.tsx";
import QuestViewQuestline from "./QuestViewQuestline.tsx";
import QuestViewRail from "./QuestViewRail.tsx";

export interface QuestViewProps {
  quest: QuestResource;
  /**
   * Which mount this is.
   *
   * - `page` is the quest route at `/:projectSlug/quests/:shortId`.
   * - `card` is the kanban board's sheet, at half the viewport's width: one
   *   narrow column, everything stacked, the back arrow doubling as the only
   *   way out.
   * - `dialog` is the questline map's popup, up to 1400px wide. It is a
   *   PREVIEW, and that is what separates it from `card`: it is the only
   *   mount whose subject has a page of its own one click away, so its
   *   title is a link there, it closes with an X rather than an arrow, and
   *   it carries Edit but none of the lifecycle verbs. Accepting or
   *   completing a quest from a popup over a map is a decision that wants
   *   the quest in front of you, not a card you opened to glance at.
   *
   * Nothing folds behind an overflow menu any more: the only section that
   * ever did was the completion summary, which is now an entry in the
   * Discussion feed on both mounts. Defaults to `page` because the route
   * loader hands this component its props and has nowhere to pass a context;
   * every other mount is explicit.
   */
  context?: QuestViewContext;
  onClose?: () => void;
  onQuestChange?: (quest: QuestResource) => void;
}

/**
 * Stateless, so one instance serves every mount.
 */
const dueDate = new QuestDueDate();

const QuestView = (props: QuestViewProps) => {
  const alepha = useAlepha();
  const questApi = useClient<QuestController>();
  const questMutations = useQuestMutations();
  const router = useRouter<AppRouter>();
  const { tr, l } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const dt = useInject(DateTimeProvider);
  const [showDialog, setShowDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completing, setCompleting] = useState(false);
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

  // Mirror the prop into local state, which the inline editors then mutate.
  // Re-seeded during render on a prop change rather than from an effect.
  const [seededQuest, setSeededQuest] = useState(props.quest);
  if (props.quest !== seededQuest) {
    setSeededQuest(props.quest);
    setQuest(props.quest);
  }

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
  const [epics] = useStore(currentEpicsAtom);
  const promptSubject = useAgentPromptSubject();

  // The epic phase gate (epic #31): a quest can be accepted only while its
  // epic is active, and this page reaches a planned epic's quest by direct
  // URL, where the backlog's own gate never applied. The refs the project
  // route already holds carry the epic's status, so Accept can say why it
  // is withheld instead of answering 400.
  const questEpic =
    quest.epicId != null
      ? epics?.find((e) => e.id === quest.epicId)
      : undefined;
  // ⚠️ The condition itself lives in `questAgentGate`, shared with the two
  // quest tables, and it answers a CODE rather than a sentence: a pure
  // helper cannot call `tr`, and duplicating the key mapping is exactly the
  // drift the extraction prevents. The mapping stays here, once.
  const withheldReason = questAgentGate(quest, epics);
  const acceptWithheld =
    withheldReason && questEpic
      ? String(
          tr(
            withheldReason === "epicPlanned"
              ? "quest.view.accept.epicPlanned"
              : "quest.view.accept.epicDone",
            { args: [String(questEpic.number)] },
          ),
        )
      : undefined;

  const context: QuestViewContext = props.context ?? "page";

  // The status chip. Same four colours the quest table's dot uses, so a
  // status reads identically in the list and on the quest.
  const statusLabel = {
    new: tr("quest.status.new"),
    accepted: tr("quest.status.accepted"),
    completed: tr("quest.status.completed"),
    shelved: tr("quest.status.shelved"),
  }[quest.metadata.status];
  // Tone rather than classes: the hue now lives in `@alepha/ui`'s Badge and
  // the meaning-to-tone map is shared with the quest table, so a status
  // cannot look like one thing in the list and another here.
  const statusTone = QUEST_STATUS_TONE[quest.metadata.status];

  // The due chip. Weekday only while the date is close enough for a weekday
  // to be unambiguous; past a week "Friday" could be any of several, so it
  // becomes a real date. Amber until it is overdue, then destructive.
  //
  // The rule itself lives in `QuestDueDate` because the board card renders
  // the same thing: two surfaces disagreeing about whether one quest is
  // overdue is the failure that extraction prevents.
  const dueChip = quest.dueAt
    ? (() => {
        const due = dueDate.describe(quest.dueAt, dt);
        return (
          <Badge variant="tint" tone={due.overdue ? "danger" : "warning"}>
            <CalendarClock className="size-3" />
            {tr("quest.view.due", {
              args: [
                String(l(quest.dueAt, { date: due.dateFormat }) ?? ""),
                String(dt.of(quest.dueAt).fromNow()),
              ],
            })}
          </Badge>
        );
      })()
    : null;

  const updateQuest = (updated: QuestResource) => {
    setQuest(updated);
    props.onQuestChange?.(updated);
  };

  /**
   * The header arrow. The breadcrumb walks *up*; this walks *back*.
   *
   * `props.onClose` first, which is how each mount names its own way out:
   * the card supplies a push to `projectKanban` (safe, and not a navigation
   * out from under the board, because the board is that route's LAYOUT and
   * stays mounted), and the questline dialog supplies its own dismiss.
   *
   * On the page mount there is no `onClose`, so `canGoBack` decides — read
   * here rather than during render, since this component renders on the
   * server too, where there is no history — and the quest list is the
   * fallback for a deep link, a refresh, or an arrival from outside.
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
      void router.push("projectQuests", {
        params: { projectSlug: project.slug },
      });
    }
  };

  /*
   * The title's own text, shared by the two elements that can carry it: a
   * plain span on the page and the kanban card, an anchor in the dialog.
   * One definition, so the id and its muted separator cannot drift apart
   * between the mounts.
   */
  const titleContent = (
    <>
      {formatReference("quest", quest.shortId)}{" "}
      <span className="text-muted-foreground">-</span> {quest.title}
    </>
  );

  /**
   * Unassign. The server method is still called `abandonQuest`, but it
   * clears `acceptedAt` / `acceptedBy` / the kanban column / the reminders
   * and pushes an `unassigned` history event — it has never deleted
   * anything, so the label and the trash icon both promised the wrong
   * thing. Deletion lives in the quest table's row actions.
   */
  const unassignQuest = {
    disabled: !questApi.abandonQuest.can(),
    onClick: async () => {
      const ok = await dialog.confirm({
        title: tr("quest.view.unassign.title"),
        description: tr("quest.view.unassign.confirm"),
        confirmLabel: tr("quest.view.unassign.confirmButton"),
        cancelLabel: tr("common.cancel"),
        destructive: true,
      });
      if (!ok) return;

      const updatedQuest = await questMutations.unassign(quest.id);
      updateQuest(updatedQuest);
      // Deliberately stays put. Unassigning releases the quest, it does not
      // remove it, so navigating back to the list read as "that is gone"
      // for something still sitting right there with its assignee cleared.
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
              args: [
                blocked
                  .map((d) => formatReference("quest", d.shortId))
                  .join(", "),
              ],
            })
          : tr("quest.view.shelve.confirm"),
        confirmLabel: tr("quest.view.shelve.confirmButton"),
        cancelLabel: tr("common.cancel"),
      });
      if (!ok) return;

      const updatedQuest = await questMutations.shelve(quest.id);
      updateQuest(updatedQuest);
      alepha.store.set(currentQuestAtom, updatedQuest);

      // The board drops a shelved card from every column, so leaving the
      // drawer open would strand it over a card that is no longer there.
      // Only the `card` mount: the `dialog` mount previews a quest over an
      // epic page that deliberately lists shelved quests, and `Questline`
      // re-resolves the open node every render, so it simply restyles.
      if (context === "card") props.onClose?.();
    },
  };

  const unshelveQuest = {
    disabled: !questApi.unshelveQuest.can(),
    onClick: async () => {
      const updatedQuest = await questMutations.unshelve(quest.id);
      updateQuest(updatedQuest);
      alepha.store.set(currentQuestAtom, updatedQuest);
    },
  };

  // Hoisted so the two mounts can place the same rail differently: the page
  // stands it up as a full-height column beside the scrolling body, the card
  // stacks it underneath.
  const railNode = (
    <QuestViewRail
      quest={quest}
      onUpdate={(it) => {
        updateQuest(it);
        alepha.store.set(currentQuestAtom, it);
      }}
      onShelve={shelveQuest.onClick}
      onUnshelve={unshelveQuest.onClick}
      onUnassign={unassignQuest.onClick}
      shelveDisabled={shelveQuest.disabled}
      unshelveDisabled={unshelveQuest.disabled}
      unassignDisabled={unassignQuest.disabled}
    />
  );

  return (
    // The quest sits directly on the page surface: no card, no border, no
    // radius, no margin.
    //
    // Transparent on the page so the shell's dot texture shows through. It
    // used to paint `bg-background` here to match the content panel, which
    // was seamless while that panel was flat and became an opaque patch the
    // moment it gained the dots.
    //
    // The card mount still paints it: there it covers the Sheet's
    // `bg-popover`, which is what keeps the drawer and the route looking
    // like one view rather than two surfaces.
    <div
      key={quest.id}
      className={
        context === "card"
          ? // One column that scrolls as a whole, because the sheet is half
            // a viewport wide and has no room to stand anything beside
            // anything else.
            "bg-background flex flex-1 flex-col overflow-hidden"
          : // Page AND dialog. Below `lg` this scrolls as one column, so the
            // rail is reached by scrolling past the body. From `lg` it stops
            // scrolling and becomes the row that stands the rail up beside
            // the body, each with its own overflow. That is also what pins
            // the header, since the sticky header then lives in the LEFT
            // column's scrollport rather than in one that holds the rail too.
            //
            // A viewport breakpoint is honest for the dialog: its width is
            // `min(1400px, 100vw-4rem)`, so it tracks the window until it
            // caps. The card is the only mount where the two disagree, and
            // the card is not in this branch.
            "bg-background flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
      }
    >
      {/* The scroll surface at `lg`: the LEFT column only, which is what
          makes the rail beside it stand still while this scrolls. Below
          `lg` it owns no scroll at all and the root above does the work. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden lg:overflow-y-auto">
        <div className="flex flex-1 flex-col gap-6 px-10 pt-7 pb-14">
          {/* Chips: what this quest IS right now, above the title that says
              what it is about. Deliberately outside the sticky header below,
              so the one line worth pinning while the body scrolls stays one
              line. `-mx-5 -mt-4` moves here because this is the flush top
              edge now, and `-mb-6` cancels the container's `gap-6`: the
              chips label the title directly below them and a 24px trench
              between the two read as two unrelated rows. */}
          {/* `pr-14` in the dialog, dropped at `lg`: below `lg` the rail
              is stacked at the bottom, so this row is what sits under the
              popup's floating close and its "updated ..." stamp would run
              beneath the X. From `lg` the rail is the top-right corner
              instead and reserves the space itself. */}
          <div
            className={`-mx-10 -mt-7 -mb-6 flex flex-wrap items-center gap-2 px-10 pt-7 ${
              context === "dialog" ? "pr-14 lg:pr-10" : ""
            }`}
          >
            <Badge variant="tint" tone={statusTone}>
              <CircleDot className="size-3" />
              {statusLabel}
            </Badge>

            {/* `feedbackId` is the feedback row's database id, not its `#P`
                number, so the badge names no number (epic #32). */}
            {quest.feedbackId != null && (
              <Badge variant="secondary" className="text-muted-foreground">
                <Inbox className="size-3" />
                {tr("quest.view.fromFeedback")}
              </Badge>
            )}

            {dueChip}

            {/* Right-aligned, and last in the DOM: it is the least important
                thing in the row and should be the last thing a screen reader
                reaches. */}
            <span className="text-muted-foreground ml-auto text-xs">
              {tr("quest.view.updated", {
                args: [String(dt.of(quest.updatedAt).fromNow())],
              })}
            </span>
          </div>

          {/* Sticky header — stays visible as the quest body scrolls.
              Works in both contexts: the route page and the kanban
              drawer share this same scroll container.
              `-mx-5` spans the full width; the top offset now belongs to the
              chips row above, which is what sits flush with the top edge.
              Carries the title (prefixed with #shortId), the priority badge
              and the edit/duplicate/timer affordances. */}
          <header className="bg-background border-border sticky top-0 z-10 -mx-10 flex items-center gap-3 border-b px-10 py-3">
            {/* Card mount only. On the page the breadcrumb already walks up
                and the arrow was redundant beside it, but in the kanban
                drawer this IS the close affordance: the sheet has no other
                visible way out, so dropping it there would strand the
                reader. */}
            {context === "card" && (
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
            )}

            {/* Title column. Tags used to stack under the title here and are
                now the rail's alone: rendering them in both places put the
                same chips on screen twice on the page mount, where the rail
                is always visible. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Inter, not Cinzel: the RPG surface is vocabulary, not
                  lettering. The page mount is 28px/600; the card back and the
                  dialog stay at 18px, where 28px would eat a half-width
                  sheet.

                  In the dialog the title is a real anchor to the quest's own
                  page. It is the one mount where "the same thing, elsewhere"
                  exists and is worth offering, and an anchor rather than a
                  handler so cmd-click opens it in a tab and hovering shows
                  where it goes. `router.path` inherits `projectSlug` from the
                  route the dialog is open over, which is always inside the
                  project. */}
              {context === "dialog" ? (
                <Link
                  href={router.path("projectQuest", {
                    params: { shortId: String(quest.shortId) },
                  })}
                  className="truncate text-lg leading-tight font-bold"
                >
                  {titleContent}
                </Link>
              ) : (
                <span
                  className={`truncate leading-tight font-semibold ${
                    context === "page"
                      ? "text-[28px] tracking-[-0.6px]"
                      : "text-lg font-bold"
                  }`}
                >
                  {titleContent}
                </span>
              )}
            </div>

            {quest.shelvedAt && (
              <Badge
                variant="secondary"
                className="text-muted-foreground shrink-0"
              >
                <Archive className="size-3" />
                {tr("quest.status.shelved")}
              </Badge>
            )}

            {/* Edit, then the lifecycle primary. The sticky bottom action
                bar this replaces held Accept / Complete opposite Shelve and
                Abandon; the mockup has no bar, so the two lifecycle verbs
                come up here — where the reader already is — and the rest
                moves into the rail. The primary slot is state-dependent:
                Accept on a `new` quest, Complete on an accepted one, nothing
                once it is done. */}
            {!quest.completedAt && project && (
              <div className="flex shrink-0 items-center gap-1">
                {/* ⚠️ Page context only, and for the same reason the
                    lifecycle verb is: the dialog withholds a decision that
                    wants the quest in front of you, and handing it to an
                    agent is that kind of decision.

                    The completed half of the gate is met by placement, this
                    whole block being inside `!quest.completedAt`; only the
                    epic phase has to be asserted, and `withheldReason` is
                    the shared helper's answer. The menu renders nothing on
                    an empty list, so a withheld quest shows no button. */}
                {context === "page" && (
                  <AgentPromptsMenu
                    items={
                      withheldReason
                        ? []
                        : [
                            {
                              kind: "questWork" as const,
                              label: String(tr("agentPrompts.workOnIt")),
                              subject: promptSubject.forQuest(quest),
                            },
                          ]
                    }
                  />
                )}
                <QuestViewEditButton
                  quest={quest}
                  onUpdate={(it) => {
                    updateQuest(it);
                    alepha.store.set(currentQuestAtom, it);
                  }}
                  showDialog={showDialog}
                  setShowDialog={setShowDialog}
                />
                {/* Edit above is on every mount; the lifecycle verb is not.
                    Accept and Complete share one slot, so the dialog drops
                    the slot rather than showing Complete and hiding Accept,
                    which would have read as "this quest cannot be taken"
                    rather than "not from here". Both verbs are one click
                    away through the title. */}
                {context === "dialog" ? null : quest.acceptedAt ? (
                  <Button
                    type="button"
                    className="bg-green-600 text-white hover:bg-green-700"
                    // No longer gated on every box being ticked: the
                    // dialog now asks for a reason per unticked objective
                    // and waives it. The old gate's only escape was to tick
                    // a box for work nobody did.
                    disabled={!questApi.completeQuest.can()}
                    onClick={() => setShowCompleteDialog(true)}
                  >
                    <Swords className="size-4" />
                    <span className="hidden sm:inline">
                      {tr("quest.view.actions.complete")}
                    </span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="bg-blue-600 text-white hover:bg-blue-700"
                    disabled={
                      !questApi.acceptQuest.can() ||
                      acceptWithheld !== undefined
                    }
                    title={acceptWithheld}
                    onClick={async () => {
                      const updatedQuest = await questMutations.accept(
                        quest.id,
                      );
                      updateQuest(updatedQuest);
                      alepha.store.set(currentQuestAtom, updatedQuest);
                    }}
                  >
                    <Signature className="size-4" />
                    <span className="hidden sm:inline">
                      {tr("quest.view.actions.accept")}
                    </span>
                  </Button>
                )}
              </div>
            )}
          </header>

          {/* Body, and below it the rail on the one mount that keeps the
              rail inside this scroll flow. Page and dialog both put theirs
              outside as a standing sibling instead, so for them this column
              holds the body alone. */}
          <div className="flex flex-col gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <QuestViewQuestline quest={quest} questline={questline} />

              {/* Description (collapsible, default expanded) */}
              <CollapsibleBlock
                icon={<FileText className="size-5" />}
                label={tr("quest.view.description")}
                defaultOpen
              >
                <QuestDescription
                  quest={quest}
                  onEdit={() => setShowDialog(true)}
                />
              </CollapsibleBlock>

              {/* Objectives (collapsible, default expanded) */}
              {quest.objectives.length > 0 && (
                <CollapsibleBlock
                  icon={<ListChecks className="size-5" />}
                  label={tr("quest.view.objectives")}
                  // Open while there is work to do, folded once there is
                  // not: on a finished quest the checklist is all ticks, and
                  // the progress in the header already says so. The reader
                  // came for what happened, which is the Discussion below.
                  defaultOpen={!quest.completedAt}
                  aside={
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        {tr("quest.view.objectivesProgress", {
                          args: [
                            String(quest.metadata.objectivesProgress.completed),
                            String(quest.metadata.objectivesProgress.total),
                          ],
                        })}
                      </span>
                      {/* Decorative: the count beside it already carries the
                          meaning, so the bar is aria-hidden rather than a
                          progressbar a screen reader has to read twice. */}
                      <div
                        aria-hidden="true"
                        className="bg-muted h-1 w-24 overflow-hidden rounded-full"
                      >
                        <div
                          className="bg-foreground/70 h-full rounded-full"
                          style={{
                            width: `${
                              quest.metadata.objectivesProgress.total > 0
                                ? Math.round(
                                    (quest.metadata.objectivesProgress
                                      .completed /
                                      quest.metadata.objectivesProgress.total) *
                                      100,
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  }
                >
                  <QuestViewObjectives
                    quest={quest}
                    onQuestUpdate={(updatedQuest) => {
                      updateQuest(updatedQuest);
                      alepha.store.set(currentQuestAtom, updatedQuest);
                    }}
                  />
                </CollapsibleBlock>
              )}

              {/* Attachments. Non-collapsible, and rendered even when empty
                  on an open quest: the section used to be hidden until a
                  file existed, which left no way to add the first one
                  without going through the edit dialog. `QuestAttachments`
                  is the upload control that already existed for that dialog
                  and had no caller at all. */}
              {(quest.attachments?.length || !quest.completedAt) && (
                <CollapsibleBlock
                  icon={<Paperclip className="size-5" />}
                  label={String(tr("quest.view.attachments"))}
                  defaultOpen
                  // The count, so a folded section still says whether there
                  // is anything in it. Without it a collapsed Attachments
                  // and an empty one look identical.
                  aside={
                    quest.attachments?.length ? (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {quest.attachments.length}
                      </span>
                    ) : undefined
                  }
                >
                  <QuestAttachments
                    questId={quest.id}
                    value={quest.attachments ?? []}
                    disabled={!!quest.completedAt}
                    onChange={async (attachments) => {
                      const updated = await questApi.updateQuestById({
                        params: { id: quest.id },
                        body: { attachments },
                      });
                      updateQuest(updated);
                      alepha.store.set(currentQuestAtom, updated);
                    }}
                  />
                </CollapsibleBlock>
              )}

              {/* Discussion: the quest's history events and its comments in
                  one feed. Collapsible like its siblings, open by default. */}
              <QuestDiscussion quest={quest} />
            </div>

            {/* The card mount stacks the rail under the body: a drawer is a
                single narrow column, and a 308px rail beside a ~360px body
                would leave neither readable. Page and dialog put it outside
                this scroll container entirely, below. */}
            {context === "card" && (
              <aside className="border-border w-full border-t pt-4">
                {railNode}
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* A full-height bar, not a card, and a SIBLING of the scroll surface
          rather than a child of it. That is what makes it stand still while
          the body scrolls, and what lets it start at the very top of the page
          instead of below the title.

          It carries its own `overflow-y-auto` because a long rail must still
          be reachable on a short viewport; it just does not move when the
          quest does. Hidden below `lg`, where the viewport cannot afford
          308px of chrome beside the prose. */}
      {/* `lg:pt-12` in the dialog only. From `lg` this panel IS the popup's
          top-right corner, and the close floats there over whatever the rail
          scrolls beneath it; without the reserve, Status and its value opened
          underneath the X. The page has no floating close, so it keeps the
          even `p-4`. */}
      {context !== "card" && (
        <aside
          className={`border-border bg-muted/20 w-full shrink-0 border-t p-4 lg:w-[308px] lg:overflow-y-auto lg:border-t-0 lg:border-l ${
            context === "dialog" ? "lg:pt-12" : ""
          }`}
        >
          {railNode}
        </aside>
      )}
      <QuestCompletionDialog
        open={showCompleteDialog}
        onOpenChange={(open) => {
          if (!completing) setShowCompleteDialog(open);
        }}
        submitting={completing}
        unticked={quest.objectives.filter((o) => !o.completed)}
        onConfirm={async (message, waive) => {
          setCompleting(true);
          try {
            const updatedQuest = await questMutations.complete(quest.id, {
              message,
              waive,
            });
            updateQuest(updatedQuest);
            alepha.store.set(currentQuestAtom, updatedQuest);
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
export type QuestViewContext = "page" | "card" | "dialog";

export default QuestView;
