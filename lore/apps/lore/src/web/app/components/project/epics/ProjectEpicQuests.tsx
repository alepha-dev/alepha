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
import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

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
  const quests = props.quests;
  const attachedIds = new Set((quests ?? []).map((q) => q.id));
  // The create sheet, opened from the toolbar beside Attach (feedback #2057).
  const [creating, setCreating] = useState(false);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <Card className="py-0 shadow">
        {/* No header row. It held the word "Quests" and the attach button
            directly above the table's own toolbar, which is two stacked bars
            saying one thing (feedback #2006). The tab is already named
            "Quests"; the button belongs in the toolbar's slot, beside the
            column picker and refresh. */}
        <CardContent className="p-0">
          {quests === null ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              {tr("epic.quests.loading")}
            </div>
          ) : (
            <AlephaTable<QuestResource>
              data={quests}
              emptyMessage={tr("epic.quests.empty")}
              // The page-level action, in the slot the table keeps for it.
              // `toolbar` rather than `actions` because this one opens a
              // popover of its own: `actions` is for icon buttons that do
              // something on click.
              toolbar={
                <>
                  {/* The page's primary action (quest #1682's form): a new
                      quest filed straight under this epic. Attach stays
                      outline beside it, for a quest that already exists. */}
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
                      title={`#${quest.shortId} - ${quest.title}`}
                    >
                      #{quest.shortId}{" "}
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
                {
                  icon: X,
                  label: tr("epic.quests.detach"),
                  destructive: true,
                  // No `ctx.refresh()`: these rows are `ProjectEpic`'s state.
                  // `onDetach` reloads it, and the table re-renders from the
                  // new array on its own.
                  onClick: () => props.onDetach(quest),
                },
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
