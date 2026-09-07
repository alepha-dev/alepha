import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Bot, Plus, X } from "lucide-react";
import { useState } from "react";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";
import { useAgentPrompt } from "../prompts/useAgentPrompt.ts";
import { useAgentPromptSubject } from "../prompts/useAgentPromptSubject.ts";
import {
  QUEST_PRIORITY_ICONS,
  QUEST_PRIORITY_RANK,
  QUEST_PRIORITY_TONE,
  QUEST_STATUS_TONE,
} from "../quest/questChips.ts";
import QuestCreate from "../quest/QuestCreate.tsx";
import EpicQuestPicker from "./EpicQuestPicker.tsx";

export interface ProjectEpicQuestsProps {
  projectId: number;
  /**
   * The epic these quests belong to, for its status: the quest set can be
   * edited only while the epic is `planned` (epic #31), and the server
   * refuses attach, detach and create-into once it is not. The affordances
   * disappear with the permission rather than answering 400.
   */
  epic: EpicResource;
  /**
   * `null` means "not loaded yet" (in flight, or the last fetch failed) —
   * distinct from a successfully resolved `[]`, so a failed reload never
   * renders as "no quests in this epic".
   */
  quests: QuestResource[] | null;
  onAttach: (questId: number) => void;
  onDetach: (quest: QuestResource) => void;
  /**
   * A quest the create sheet just made, for the owner of this list to file
   * under the epic and reload. The sheet is told to stay put (`onCreated`),
   * so the reader keeps the epic's page rather than landing on the quest's.
   */
  onCreated: (quest: QuestResource) => void | Promise<void>;
}

/**
 * The Quests tab of the Epic page: the full quest set — shelved and
 * planned-gated quests included, since `EpicController`'s rollup and the
 * `epic`-filtered `QuestController.getQuests` call that feeds this component
 * both bypass the backlog gate on purpose.
 *
 * The dependency flow used to hang off the bottom of this card in a fixed
 * 480px band. It is its own tab now (`ProjectEpicFlow`), because a graph
 * given half a viewport and no way to grow was the smaller half of a
 * scrolling page.
 *
 * `AlephaTable` in static-data mode, not fetch mode, and that is the whole
 * reason the mode exists. `ProjectEpic` loads the epic's quests once and
 * hands the same array to the aside rollup, the flow graph, the tab count
 * and this table; a table that fetched for itself would be a second source
 * of truth, and a detach would leave the other three showing the old
 * membership until the next navigation. It also sidesteps the shape
 * mismatch: the epic set is two requests concatenated (the default status
 * filter drops shelved quests server-side), which no single `fetch` ->
 * `Page<T>` can express.
 */
const ProjectEpicQuests = (props: ProjectEpicQuestsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dateFormatter = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);
  const agentPrompt = useAgentPrompt();
  const promptSubject = useAgentPromptSubject();
  const quests = props.quests;
  const attachedIds = new Set((quests ?? []).map((q) => q.id));
  // The create sheet, opened from the toolbar beside Attach (feedback #2057).
  const [creating, setCreating] = useState(false);
  // The plan freeze (epic #31): once the epic has begun, the quest set is
  // what was committed. Create, Attach and Detach all go with it.
  const planEditable = props.epic.status === "planned";

  return (
    /*
     * ⚠️ `overflow-hidden`, not `overflow-auto`, and the chain below it is
     * the whole fix (feedback #2103).
     *
     * MEASURED before changing anything, because the report and the quest
     * both guessed wrong about where the scroll was. At 1440x800 with 26
     * quests, `document` did NOT scroll and neither did `body`: the only
     * element in the chain with `scrollHeight > clientHeight` was THIS div,
     * at 1156 in a 670 box. What reads as a window scrollbar in the
     * screenshot is this tab's own, sitting hard against the right edge of
     * the content column.
     *
     * So nothing above `DetailLayout` is at fault and neither is
     * `DetailLayout`: it already hands its children a bounded height (670
     * inside a 726 column, once its own 56px header is taken). The chain
     * stopped one level LOWER, at the `Card` and `CardContent`, which had
     * no `min-h-0 flex-1`, so `AlephaTable`'s body container - which is
     * already `overflow-auto` - measured 1020 tall in a 1020 box and had
     * nothing to scroll. This tab scrolled instead, taking the table's
     * header row and its pager with it.
     *
     * Bounding it here rather than in `DetailLayout` is therefore the
     * correct fix and not the cheap one. Overview, Flow and Folios use the
     * SAME `overflow-auto` wrapper on purpose: prose and a folio list have
     * no inner scroll region to hand off to, so scrolling the tab is right
     * for them. A scroll region added to `DetailLayout` would give those
     * three a second scrollbar.
     */
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <Card className="flex min-h-0 flex-1 flex-col py-0 shadow">
        {/* No header row. It held the word "Quests" and the attach button
            directly above the table's own toolbar, which is two stacked bars
            saying one thing (feedback #2006). The tab is already named
            "Quests"; the button belongs in the toolbar's slot, beside the
            column picker and refresh. */}
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {quests === null ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              {tr("epic.quests.loading")}
            </div>
          ) : (
            <AlephaTable<QuestResource>
              // The last link of the chain, and the same one every
              // standalone list page uses.
              className="min-h-0 flex-1"
              data={quests}
              emptyMessage={tr("epic.quests.empty")}
              // The page-level action, in the slot the table keeps for it.
              // `toolbar` rather than `actions` because this one opens a
              // popover of its own: `actions` is for icon buttons that do
              // something on click.
              toolbar={
                planEditable ? (
                  <>
                    {/* The page's primary action (quest #1682's form): a new
                        quest filed straight under this epic. Attach stays
                        outline beside it, for a quest that already exists.
                        Neither once the plan is frozen: the route for new
                        work is an objective on a quest already here, or a
                        new epic. */}
                    <Button
                      type="button"
                      size="sm"
                      disabled={!project}
                      onClick={() => setCreating(true)}
                    >
                      <Plus className="size-4" />
                      {tr("epic.quests.create")}
                    </Button>
                    <EpicQuestPicker
                      projectId={props.projectId}
                      attachedIds={attachedIds}
                      onAttach={props.onAttach}
                    />
                  </>
                ) : undefined
              }
              // Per project, not per epic: how the reader likes this table
              // sorted is a preference about quests, not about one epic.
              persistenceKey={`lor.epicQuests.${props.projectId}`}
              onRowClick={(quest) =>
                router.push("projectQuest", {
                  params: { shortId: String(quest.shortId) },
                })
              }
              // Status first, then the anchor, then the two most consulted
              // fields: the Quests list's order, so the two tables read as
              // one (feedback #2062).
              columns={{
                status: {
                  label: tr("epic.quests.column.status"),
                  sortable: true,
                  className: "w-32",
                  // The status is derived, not a column of the row, so the
                  // sort needs telling what to compare.
                  sortValue: (quest) => quest.metadata.status,
                  // The same chip the quest view shows, from the same tone
                  // table and the same catalog keys. This page used to carry
                  // its own copy of both, which is how the epic page came to
                  // say "Accepted" where every other surface says "In
                  // progress".
                  cell: (quest) => (
                    <Badge
                      variant="tint"
                      tone={QUEST_STATUS_TONE[quest.metadata.status]}
                    >
                      {tr(`quest.status.${quest.metadata.status}`)}
                    </Badge>
                  ),
                },
                title: {
                  label: tr("epic.quests.column.title"),
                  sortable: true,
                  className: "w-full max-w-0 min-w-48",
                  cell: (quest) => (
                    // A real anchor rather than a span inside the clickable
                    // row, so the browser owns shift / cmd / middle click and
                    // can offer "copy link address". `stopPropagation`
                    // because the row carries `onRowClick` too, and without
                    // it a plain click navigates twice.
                    //
                    // The Quests list's cell: number and title in one name,
                    // the whole of it the link, only the dash muted.
                    <Link
                      href={router.path("projectQuest", {
                        params: { shortId: String(quest.shortId) },
                      })}
                      onClick={(e) => e.stopPropagation()}
                      className={`block truncate text-sm font-medium ${quest.completedAt ? "text-muted-foreground line-through" : ""}`}
                      title={`${formatReference("quest", quest.shortId)} - ${quest.title}`}
                    >
                      {formatReference("quest", quest.shortId)}{" "}
                      <span className="text-muted-foreground">-</span>{" "}
                      {quest.title}
                    </Link>
                  ),
                },
                priority: {
                  label: tr("epic.quests.column.priority"),
                  sortable: true,
                  className: "w-32",
                  // By weight, not by the word: see `QUEST_PRIORITY_RANK`.
                  sortValue: (quest) => QUEST_PRIORITY_RANK[quest.priority],
                  cell: (quest) => {
                    const Icon = QUEST_PRIORITY_ICONS[quest.priority];
                    return (
                      <Badge
                        variant="tint"
                        tone={QUEST_PRIORITY_TONE[quest.priority]}
                        className="capitalize"
                      >
                        <Icon className="size-3" />
                        {quest.priority}
                      </Badge>
                    );
                  },
                },
                updatedAt: {
                  label: tr("epic.quests.column.updated"),
                  sortable: true,
                  className: "w-32",
                  cell: (quest) => (
                    <span className="text-muted-foreground text-xs">
                      {dateFormatter.of(quest.updatedAt).fromNow()}
                    </span>
                  ),
                },
              }}
              rowActions={(quest) => [
                ...(planEditable
                  ? [
                      {
                        icon: X,
                        label: tr("epic.quests.detach"),
                        destructive: true,
                        // No `ctx.refresh()`: these rows are `ProjectEpic`'s
                        // state. `onDetach` reloads it, and the table
                        // re-renders from the new array on its own.
                        onClick: () => props.onDetach(quest),
                      },
                    ]
                  : []),
                // ⚠️ Outside the `planEditable` branch, because this is
                // exactly the case that had no row menu at all: on an
                // ACTIVE epic the plan is frozen, so Detach is gone, and
                // an active epic is precisely when its quests are being
                // handed out one at a time.
                //
                // The two never coexist by construction: a planned epic
                // gets Detach and no group (the gate wants `active`), an
                // active one gets the group and no Detach, a concluded one
                // gets neither. The group is OMITTED here rather than
                // handed over empty, and #Q1959's effective-entry count is
                // the backstop rather than the mechanism.
                //
                // ⚠️ The gate reads `props.epic.status` and NOT
                // `questAgentGate`. The shared helper resolves a quest's
                // epic through `currentEpicsAtom`, which this table has no
                // other reason to read and which is `undefined` after a
                // failed load; the epic is a PROP here, so its phase is
                // known directly. Same condition, better source.
                ...(agentPrompt.enabled &&
                !quest.completedAt &&
                props.epic.status === "active"
                  ? [
                      {
                        icon: Bot,
                        label: tr("agentPrompts.menu"),
                        children: [
                          {
                            icon: Bot,
                            label: tr("agentPrompts.workOnIt"),
                            onClick: (row: QuestResource) =>
                              agentPrompt.copy(
                                "questWork",
                                promptSubject.forQuest(row),
                              ),
                          },
                        ],
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* The same `QuestCreate` the header and the Quests list open. The
          epic is context, not a field: the sheet knows nothing of it, and
          `onCreated` hands the new quest to the page, which attaches it. */}
      {project && (
        <Sheet open={creating} onOpenChange={setCreating}>
          <SheetContent
            side="right"
            className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
          >
            <SheetHeader className="shrink-0">
              <SheetTitle>{tr("epic.quests.create")}</SheetTitle>
            </SheetHeader>
            {creating ? (
              <QuestCreate
                project={project}
                onSubmit={() => setCreating(false)}
                onCreated={(quest) => void props.onCreated(quest)}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
};

export default ProjectEpicQuests;
