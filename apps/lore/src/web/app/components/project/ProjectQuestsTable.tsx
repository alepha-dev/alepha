import {
  AlephaTable,
  type BulkAction,
  type BulkMenuAction,
} from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  Hash,
  Layers,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Signature,
  Flag,
  Tag,
  Trash,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { User } from "@/api/entities/users.ts";
import { QUEST_RELEASE_NONE } from "@/api/schemas/questReleaseFilter.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { currentAreasAtom } from "../../atoms/currentAreasAtom.ts";
import { currentEpicsAtom } from "../../atoms/currentEpicsAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../atoms/currentReleasesAtom.ts";
import { descriptionSnippet } from "../../services/descriptionSnippet.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
import { formatReference } from "../shared/element/typedReference.ts";
import FilterSlot from "../shared/FilterSlot.tsx";
import { useBulkReport } from "../shared/useBulkReport.ts";
import { useQuestMutations } from "../shared/useQuestMutations.ts";
import { UserAvatar } from "../shared/UserAvatar.tsx";
import {
  QUEST_PRIORITY_ICONS,
  QUEST_PRIORITY_TONE,
} from "./quest/questChips.ts";
import QuestCreate from "./quest/QuestCreate.tsx";
import { formatQuestSize } from "./quest/questSize.ts";

/**
 * Board filter shape. Empty by default → "All statuses", which means
 * everything still in scope: shelved quests are excluded server-side
 * until you ask for them explicitly. AlephaTable persists the chosen
 * values per project via `persistenceKey` (see #113).
 */
/**
 * ⚠️ Every filter but `search` is a LIST, and empty means all.
 *
 * The board has taken lists since it was written while this table took one
 * value each, so "new or in progress", or two areas at once, was expressible
 * on one surface and not the other (quest #1644). The shape is ported from
 * `KanbanBoard.tsx` rather than designed, and `Control` needs nothing new:
 * an array field already renders as a multi-select.
 *
 * On the wire each list is comma-joined into a single query param, which is
 * what `getQuests` accepts. A repeated key would be the other option and is
 * not available: `ServerProvider.parseQueryString` returns
 * `Record<string, string>`, so `?area=a&area=b` keeps only the last one.
 */
const boardFiltersSchema = z.object({
  search: z.string().optional(),
  status: z
    .array(z.enum(["new", "accepted", "completed", "shelved"]))
    .optional(),
  area: z.array(z.string()).optional(),
  tag: z.array(z.string()).optional(),
  // The releases' numeric ids, carried as strings because that is what a
  // select's value is. Coerced back on the way into the query.
  release: z.array(z.string()).optional(),
});

/**
 * The `?status=` values this page understands.
 *
 * Anything else in the URL is dropped rather than rejected: a stale bookmark
 * or a hand-edited link must land on the unfiltered list, not on an error
 * page or an empty table with no visible cause.
 */
const SEEDABLE_STATUSES = ["new", "accepted", "completed", "shelved"] as const;

const ProjectQuestsTable = () => {
  const [project] = useStore(currentProjectAtom);
  const [currentAreas] = useStore(currentAreasAtom);
  const [releases] = useStore(currentReleasesAtom);
  const [epics] = useStore(currentEpicsAtom);
  const questApi = useClient<QuestController>();
  const questMutations = useQuestMutations();
  const reportBulk = useBulkReport();
  const projectApi = useClient<ProjectController>();
  const dateFormatter = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const [users, setUsers] = useState<Array<User>>([]);
  // The row whose edit drawer is open, or nothing. Held here rather than per
  // row: one Sheet for the table, the same way the delete confirm is one
  // dialog rather than 25.
  const [editing, setEditing] = useState<QuestResource | undefined>();
  // Bumped when the edit drawer saves. A row action gets `ctx.refresh()`, but
  // the drawer outlives the menu that opened it, so this is the escape hatch
  // `refreshSignal` exists for.
  const [reload, setReload] = useState(0);
  // The create sheet, opened from the toolbar's primary action. The same
  // drawer as the edit one below, with no row in it.
  const [creating, setCreating] = useState(false);
  const [knownTags, setKnownTags] = useState<string[]>([]);

  /**
   * The status the reader arrived with, if any.
   *
   * Read straight off the route and handed to AlephaTable as `seedValues`,
   * which outranks the persisted filter — a drill-through link that lost to
   * a filter set last week would be a link that does nothing.
   *
   * ⚠️ Read-only. Nothing here writes the filter back to the URL; see the
   * `projectQuests` route for the #156 incident that rule comes from.
   */
  const seededStatus = SEEDABLE_STATUSES.find(
    (status) => status === router.query.status,
  );

  useEffect(() => {
    if (!project?.id) return;
    questApi
      .listQuestTags({ query: { projectId: project.id } })
      .then(setKnownTags)
      .catch(() => null);
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    projectApi
      .getProjectUsers({ params: { id: project.id } })
      .then(setUsers)
      .catch(() => null);
  }, [project?.id]);

  const renderAvatar = (userId?: string) => {
    const user = userId ? users.find((u) => u.id === userId) : undefined;
    return (
      <UserAvatar fileId={user?.picture} className="size-6" alt="user avatar" />
    );
  };

  if (!project) return null;

  const areaOptions = (currentAreas ?? []).map((a) => ({
    value: a.name,
    label: a.name,
  }));

  // Every release, published included: this is a filter over history, not a
  // picker for an attachment, so hiding what has shipped would make the
  // table unable to answer "what went into 0.27.0".
  //
  // Led by "No release", which is not a release: "what is still unassigned"
  // is the question a release planner asks most, and every option being a
  // release left it unanswerable. Named that rather than "None", which in a
  // filter reads as "no filter".
  const releaseOptions = [
    {
      value: QUEST_RELEASE_NONE,
      label: String(tr("board.filter.noRelease")),
    },
    ...(releases ?? []).map((r) => ({
      value: String(r.id),
      label: r.tag ?? r.title,
    })),
  ];

  const count = (ids: number[]) => String(ids.length);

  // Triage in bulk: the checkbox column exists because this array is not
  // empty. Every action refreshes and then clears, in that order, since a
  // selection surviving a delete points at rows that no longer exist.
  const bulkActions: Array<
    BulkAction<QuestResource> | BulkMenuAction<QuestResource>
  > = [];

  if (questApi.shelveQuest.can()) {
    bulkActions.push({
      icon: Archive,
      label: tr("board.bulk.shelve"),
      // Offered only when something in the selection is not shelved yet; a
      // selection of shelved rows has nothing for it to do (feedback #2063).
      visible: (selected) => selected.some((quest) => !quest.shelvedAt),
      onClick: async (selected, ctx) => {
        // Only a `new` quest can be shelved, and the server refuses the
        // rest one by one. They are counted here and never sent, so an
        // accepted row in the selection costs a note, not the batch.
        const eligible = selected.filter(
          (quest) =>
            !quest.acceptedAt && !quest.completedAt && !quest.shelvedAt,
        );
        const skipped = selected.length - eligible.length;
        if (eligible.length === 0) {
          toaster.error(tr("board.bulk.shelve.none"));
          return;
        }
        const outcome = await questMutations.shelveMany(
          eligible.map((quest) => quest.id),
        );
        reportBulk(
          outcome,
          String(tr("board.bulk.shelved", { args: [count(outcome.done)] })),
          skipped > 0
            ? String(
                tr("board.bulk.shelve.skipped", { args: [String(skipped)] }),
              )
            : undefined,
        );
        ctx.refresh();
        ctx.clearSelection();
      },
    });
  }

  if (questApi.unshelveQuest.can()) {
    bulkActions.push({
      icon: ArchiveRestore,
      label: tr("board.bulk.unshelve"),
      // And this one only when at least one selected row is shelved. A mixed
      // selection shows both, each acting on the rows it fits.
      visible: (selected) => selected.some((quest) => quest.shelvedAt),
      onClick: async (selected, ctx) => {
        const eligible = selected.filter((quest) => quest.shelvedAt);
        const skipped = selected.length - eligible.length;
        if (eligible.length === 0) {
          toaster.error(tr("board.bulk.unshelve.none"));
          return;
        }
        const outcome = await questMutations.unshelveMany(
          eligible.map((quest) => quest.id),
        );
        reportBulk(
          outcome,
          String(tr("board.bulk.unshelved", { args: [count(outcome.done)] })),
          skipped > 0
            ? String(
                tr("board.bulk.unshelve.skipped", { args: [String(skipped)] }),
              )
            : undefined,
        );
        ctx.refresh();
        ctx.clearSelection();
      },
    });
  }

  if (questApi.updateQuestById.can()) {
    bulkActions.push({
      icon: Flag,
      label: tr("board.bulk.release"),
      // The filter column above lists EVERY release, published included,
      // because it filters over history. This must not: attaching to a
      // published release is refused server-side, so a published entry
      // here would be a menu item that can only fail.
      items: () =>
        (releases ?? [])
          .filter((release) => !release.releasedAt)
          .map((release) => ({
            label: release.tag ?? release.title,
            onClick: async (selected, ctx) => {
              const outcome = await questMutations.attachToRelease(
                selected.map((quest) => quest.id),
                release.id,
              );
              reportBulk(
                outcome,
                String(
                  tr("board.bulk.released", {
                    args: [count(outcome.done), release.tag ?? release.title],
                  }),
                ),
              );
              ctx.refresh();
              ctx.clearSelection();
            },
          })),
    });
  }

  if (questApi.deleteQuest.can()) {
    bulkActions.push({
      icon: Trash,
      label: tr("board.bulk.delete"),
      destructive: true,
      onClick: async (selected, ctx) => {
        const n = String(selected.length);
        const confirmed = await dialog.confirm({
          title: tr("board.bulk.delete.title", { args: [n] }),
          description: tr("board.confirm-delete-message"),
          confirmLabel: tr("board.bulk.delete.confirm", { args: [n] }),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
        const outcome = await questMutations.removeMany(
          selected.map((quest) => quest.id),
        );
        reportBulk(
          outcome,
          String(tr("board.bulk.deleted", { args: [count(outcome.done)] })),
        );
        ctx.refresh();
        ctx.clearSelection();
      },
    });
  }

  return (
    <div
      data-testid="quests-table"
      className="flex flex-1 flex-col overflow-hidden"
    >
      <AlephaTable<QuestResource>
        // The seed is part of the identity: `initialValues` are captured once
        // per mount, and arriving from a different drill-through link on a
        // route the app is already showing would otherwise change nothing.
        key={`${project.id}:${seededStatus ?? ""}`}
        className="min-h-0 flex-1"
        emptyMessage={tr("common.noResults")}
        // AlephaTable owns the filter form + toolbar, and persists filter
        // values, column visibility, and sort under this key (replaces the
        // hand-rolled toolbar + localStorage that used to live here).
        persistenceKey={`lor.board.${project.id}`}
        refreshSignal={reload}
        bulkActions={bulkActions}
        // The table's one primary action, labelled so it is visible (quest
        // #1682): the same sheet the header's create button opens, staying
        // on the list once the quest exists rather than leaving for its page.
        actions={[
          {
            icon: Plus,
            label: tr("project.menu.create-quest"),
            primary: true,
            disabled: !questApi.createQuest.can(),
            onClick: () => setCreating(true),
          },
        ]}
        filters={{
          schema: boardFiltersSchema,
          seedValues: seededStatus ? { status: [seededStatus] } : undefined,
          render: (form) => (
            <>
              <FilterSlot>
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={tr("board.filter.search")}
                  inputProps={{ "aria-label": tr("board.filter.search") }}
                />
              </FilterSlot>
              <FilterSlot>
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel={tr("board.filter.allStatuses")}
                  countLabel={(n) =>
                    String(
                      tr("board.filter.statusCount", { args: [String(n)] }),
                    )
                  }
                  triggerClassName="w-full"
                  items={(
                    ["new", "accepted", "completed", "shelved"] as const
                  ).map((status) => ({
                    label: String(tr(`quest.status.${status}`)),
                    value: status,
                  }))}
                  inputProps={{ "aria-label": tr("board.filter.status") }}
                />
              </FilterSlot>
              {areaOptions.length > 0 && (
                <FilterSlot>
                  <Control
                    input={form.input.area}
                    label=""
                    clearable
                    icon={MapPin}
                    clearLabel={tr("board.filter.allAreas")}
                    countLabel={(n) =>
                      String(
                        tr("board.filter.areaCount", { args: [String(n)] }),
                      )
                    }
                    // Opted in rather than left to the option count. Areas
                    // are named by import path (`lore/quests`, `lore/folios`),
                    // so the "select every match" row - the whole of feedback
                    // #2009 - only appears once a prefix has been TYPED, and
                    // typing needs this field. A project under the search
                    // threshold would otherwise lose prefix-selection
                    // entirely: a default meant to remove noise quietly
                    // removing a feature.
                    searchable
                    triggerClassName="w-full"
                    items={areaOptions}
                    inputProps={{ "aria-label": tr("board.filter.area") }}
                  />
                </FilterSlot>
              )}
              {(releases ?? []).length > 0 && (
                <FilterSlot>
                  <Control
                    input={form.input.release}
                    label=""
                    clearable
                    icon={Flag}
                    clearLabel={tr("board.filter.allReleases")}
                    countLabel={(n) =>
                      String(
                        tr("board.filter.releaseCount", { args: [String(n)] }),
                      )
                    }
                    triggerClassName="w-full"
                    items={releaseOptions}
                    inputProps={{ "aria-label": tr("board.filter.release") }}
                  />
                </FilterSlot>
              )}
              {knownTags.length > 0 && (
                <FilterSlot>
                  <Control
                    input={form.input.tag}
                    label=""
                    clearable
                    icon={Tag}
                    clearLabel={tr("board.filter.allTags")}
                    countLabel={(n) =>
                      String(tr("board.filter.tagCount", { args: [String(n)] }))
                    }
                    triggerClassName="w-full"
                    items={knownTags.map((tag) => ({ label: tag, value: tag }))}
                    inputProps={{ "aria-label": tr("board.filter.tag") }}
                  />
                </FilterSlot>
              )}
            </>
          ),
        }}
        fetch={async ({ page, size, sort, filters: f }) => {
          // Comma-joined, and omitted entirely when empty. An empty list and
          // an absent filter are the same question, and sending `status=`
          // would be a third thing for the endpoint to interpret.
          const list = (values: unknown): string | undefined =>
            Array.isArray(values) && values.length > 0
              ? values.join(",")
              : undefined;
          return questApi.getQuests({
            params: { projectId: project.id },
            query: {
              page,
              size,
              sort,
              search: f?.search || undefined,
              status: list(f?.status),
              area: list(f?.area),
              tag: list(f?.tag),
              releaseId: list(f?.release),
            } as any,
          });
        }}
        onRowClick={(quest) =>
          router.push("projectQuest", {
            params: { shortId: String(quest.shortId) },
          })
        }
        columns={{
          status: {
            label: tr("board.table.status"),
            className: "pl-4",
            cell: (quest: QuestResource) => {
              const colors: Record<string, string> = {
                new: "bg-blue-500",
                accepted: "bg-orange-500",
                completed: "bg-green-500",
                shelved: "bg-muted-foreground/50",
              };
              return (
                <span
                  className={`inline-block size-2.5 rounded-full ${colors[quest.metadata.status] ?? "bg-muted"}`}
                />
              );
            },
          },
          assignedTo: {
            label: tr("board.table.assigned"),
            cell: (quest: QuestResource) => {
              if (!quest.acceptedBy) {
                return <span className="text-muted-foreground">-</span>;
              }
              const user = users.find((u) => u.id === quest.acceptedBy);
              return (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    {renderAvatar(quest.acceptedBy)}
                  </TooltipTrigger>
                  <TooltipContent className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {displayName(user, quest.acceptedBy)}
                    </span>
                    {quest.acceptedAt && (
                      <span className="text-muted-foreground text-xs">
                        {`${tr("board.table.assigned")} ${dateFormatter.of(quest.acceptedAt).fromNow()}`}
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            },
          },
          title: {
            label: tr("board.table.title"),
            sortable: true,
            // `w-full max-w-0` is what makes truncation follow the available
            // width instead of a character count: the table is auto-layout,
            // so `max-width: 0` stops this column claiming its content width
            // and `width: 100%` makes it absorb whatever the other columns
            // leave. Without the pair, the column grows to fit the longest
            // title and `text-overflow: ellipsis` never fires.
            //
            // `min-w-48` is the floor the pair needs. Once the other columns'
            // intrinsic widths fill the container there is nothing left for
            // `width: 100%` to claim, and `max-width: 0` then collapses this
            // column to literally zero — at 1024px the titles disappeared
            // entirely and the header overlapped the next one. min-width wins
            // over max-width, so the column stops shrinking there and the
            // table's own `overflow-x-auto` container takes over.
            className: "w-full max-w-0 min-w-48",
            cell: (quest: QuestResource) => (
              <div className="flex flex-col overflow-hidden whitespace-nowrap">
                {/* A real anchor, not a span inside the clickable row: that
                    way the browser owns shift / cmd / middle click, shows the
                    target URL on hover, and offers "copy link address". The
                    router bails on modified clicks without preventDefault, so
                    a new tab opens natively while a plain click still routes
                    in place. Same reasoning as the project switcher's rows
                    (Lore feedback #61).

                    `stopPropagation` because the row carries `onRowClick`
                    too, and without it a plain click navigates twice: once
                    through the anchor, once through the row. It is the guard
                    the table's own checkbox cell already uses. */}
                <Link
                  href={router.path("projectQuest", {
                    params: { shortId: String(quest.shortId) },
                  })}
                  onClick={(e) => e.stopPropagation()}
                  className={`truncate text-sm font-medium ${quest.completedAt ? "text-muted-foreground line-through" : ""}`}
                  title={`${formatReference("quest", quest.shortId)} - ${quest.title}`}
                >
                  {/* The id carries the title's own colour: it is part of
                      the name, not an annotation on it. Only the separator
                      is muted, same treatment as the quest header. */}
                  {formatReference("quest", quest.shortId)}{" "}
                  <span className="text-muted-foreground">-</span> {quest.title}
                </Link>
                {quest.description && (
                  <span className="text-muted-foreground truncate text-xs">
                    {descriptionSnippet(quest.description)}
                  </span>
                )}
              </div>
            ),
          },
          tags: {
            label: tr("board.table.tags"),
            // One line, always. As wrapping chips this column set the row
            // height: a quest with five tags stood three rows tall and threw
            // the whole table's rhythm out, and the tallest row won.
            //
            // `max-w-0` + `truncate` is what actually holds the line. Without
            // the pair the cell claims its content width and the text never
            // reaches the ellipsis, so a long tag list would still push the
            // table wide instead of tall. Same trick the title column uses,
            // and `min-w-24` keeps it from collapsing to nothing.
            className: "max-w-0 min-w-24",
            cell: (quest: QuestResource) =>
              quest.tags && quest.tags.length > 0 ? (
                <span
                  className="text-muted-foreground block truncate text-xs"
                  title={quest.tags.join(", ")}
                >
                  {quest.tags.join(", ")}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          releaseId: {
            label: tr("board.table.release"),
            // Niche enough to start hidden, like `linked`: most projects run
            // one release at a time and the filter above answers the common
            // question. The column is for reading a mixed list.
            defaultHidden: true,
            className: "w-28",
            cell: (quest: QuestResource) => {
              const release = releases?.find((r) => r.id === quest.releaseId);
              return release ? (
                <Badge variant="outline" className="font-mono">
                  <Flag className="size-3" />
                  {release.tag ?? release.title}
                </Badge>
              ) : (
                <span className="text-muted-foreground">-</span>
              );
            },
          },
          epicId: {
            label: tr("board.table.epic"),
            // Hidden by default, like its two neighbours: most quests carry no
            // epic at all, and the ones that do are read from the epic's own
            // page more often than from here.
            defaultHidden: true,
            className: "w-24",
            cell: (quest: QuestResource) => {
              // ⚠️ Resolved, never printed raw. `quest.epicId` is the global
              // database id; the identifier a reader knows and the one
              // `/epics/:epicNumber` takes is the per-project `number`.
              // Rendering `#${quest.epicId}` prints a number nobody
              // recognises AND links to a different epic, and both failures
              // look like a working column.
              const epic = epics?.find((e) => e.id === quest.epicId);
              if (!epic) {
                return <span className="text-muted-foreground">-</span>;
              }
              return (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      // A real anchor for the same reasons the title column
                      // gives, `stopPropagation` included: the row carries
                      // `onRowClick` to the quest, so without it a click here
                      // navigates twice, once to the epic and once to the
                      // quest.
                      <Link
                        href={router.path("projectEpic", {
                          params: { epicNumber: String(epic.number) },
                        })}
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                      />
                    }
                  >
                    <Layers className="size-3.5" />
                    {formatReference("epic", epic.number)}
                  </TooltipTrigger>
                  <TooltipContent>{epic.title}</TooltipContent>
                </Tooltip>
              );
            },
          },
          linked: {
            label: tr("board.table.linked"),
            // Niche column — starts hidden; users opt in via the column picker.
            defaultHidden: true,
            // ⚠️ `quest.dependsOn` is the predecessor's database id, not its
            // per-project number, and the row carries nothing else about it.
            // This column used to print that id after a `#`, a reference to a
            // quest nobody has, so it now says only that a predecessor exists
            // (epic #32). The quest page names it.
            cell: (quest: QuestResource) =>
              quest.dependsOn ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs" />
                    }
                  >
                    <Link2 className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {tr("board.table.linked.tooltip")}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          priority: {
            label: tr("board.table.priority"),
            sortable: true,
            cell: (quest: QuestResource) => {
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
          // ⚠️ Sorted on `size`, the INTEGER column, not on the label this
          // cell renders. `sort` is passed straight through to `getQuests`
          // and resolved against the entity, so SQL orders 1..5 and XS..XL
          // come out in the right order for free. Sorting the label instead
          // is exactly the mistake that put `optional` above `high` on the
          // kanban board for its whole life: `priority` is a TEXT enum, which
          // is why the questlog has to carry its own order map for it.
          //
          // Hidden by default. The table is already wide, and `size` has had
          // no reader at all since it replaced `difficulty`, so it earns its
          // place in the picker before it earns a permanent column.
          size: {
            label: tr("board.table.size"),
            sortable: true,
            defaultHidden: true,
            className: "w-20",
            cell: (quest: QuestResource) => {
              const label = formatQuestSize(quest.size);
              return label ? (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {label}
                </Badge>
              ) : null;
            },
          },
          area: {
            label: tr("board.table.area"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-xs">{quest.area}</span>
            ),
          },
          createdAt: {
            label: tr("board.table.created"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(quest.createdAt).fromNow()}
              </span>
            ),
          },
          updatedAt: {
            label: tr("board.table.updated"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(quest.updatedAt).fromNow()}
              </span>
            ),
          },
        }}
        rowActions={(quest) => [
          // ⚠️ Ahead of the lifecycle moves on purpose. These two are the
          // things done most often from a list - paste a reference into a
          // commit or a prompt, nudge a priority - and neither existed here,
          // so both cost a page load and a trip back (feedback #2010).
          {
            icon: Hash,
            label: tr("board.action.copyId"),
            onClick: async () => {
              // The `#Q12` reference, not the row id. That is the form the
              // whole app speaks: quest titles, `[[#Q12]]` over MCP, and what
              // someone types into a commit message. The row id is a
              // database detail nobody pastes anywhere.
              const reference = formatReference("quest", quest.shortId);
              try {
                await navigator.clipboard.writeText(reference);
                toaster.success(
                  tr("board.action.copiedId", { args: [reference] }),
                );
              } catch {
                toaster.error(tr("board.action.copyIdError"));
              }
            },
          },
          ...(questApi.updateQuestById.can()
            ? [
                {
                  icon: Pencil,
                  label: tr("board.action.editQuest"),
                  // The same drawer the quest page opens, so a priority
                  // change is one gesture rather than a navigation.
                  onClick: () => setEditing(quest),
                },
              ]
            : []),
          ...(!quest.acceptedAt && questApi.acceptQuest.can()
            ? [
                {
                  icon: Signature,
                  label: tr("board.action.acceptQuest"),
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    await questMutations.accept(quest.id);
                    refresh();
                  },
                },
              ]
            : []),
          ...(!quest.shelvedAt && questApi.shelveQuest.can()
            ? [
                {
                  icon: Archive,
                  label: tr("board.action.shelveQuest"),
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    // Same warning QuestView gives: shelving a quest others
                    // depend on leaves them blocked with no path forward.
                    // The questline is fetched on click rather than per row —
                    // a table of 25 quests should not cost 25 extra requests
                    // for a menu entry most rows never open.
                    const questline = await questApi
                      .getQuestLine({ params: { id: quest.id } })
                      .catch(() => ({ dependents: [] }));
                    const blocked = questline.dependents.filter(
                      (d) => !d.completedAt,
                    );
                    const confirmed = await dialog.confirm({
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
                    if (!confirmed) return;
                    await questMutations.shelve(quest.id);
                    refresh();
                  },
                },
              ]
            : []),
          ...(quest.shelvedAt && questApi.unshelveQuest.can()
            ? [
                {
                  icon: ArchiveRestore,
                  label: tr("board.action.unshelveQuest"),
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    await questMutations.unshelve(quest.id);
                    refresh();
                  },
                },
              ]
            : []),
          ...(questApi.deleteQuest.can()
            ? [
                {
                  icon: Trash,
                  label: tr("board.action.deleteQuest"),
                  destructive: true,
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    const confirmed = await dialog.confirm({
                      title: tr("board.confirm-delete-title"),
                      description: tr("board.confirm-delete-message"),
                      destructive: true,
                    });
                    if (!confirmed) return;
                    await questMutations.remove(quest.id);
                    refresh();
                  },
                },
              ]
            : []),
        ]}
      />

      {/* One drawer for the table, opened by whichever row asked, or by the
          toolbar's create action with no row. The same `QuestCreate` the
          quest page edits through, so there is one editor rather than a
          second, thinner one for lists. */}
      <Sheet
        open={editing !== undefined || creating}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(undefined);
            setCreating(false);
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>
              {editing
                ? tr("quest.create.update")
                : tr("project.menu.create-quest")}
            </SheetTitle>
          </SheetHeader>
          {editing || creating ? (
            <QuestCreate
              project={project}
              quest={editing}
              onSubmit={() => {
                setEditing(undefined);
                setCreating(false);
                setReload((n) => n + 1);
              }}
              // Given, so a created quest lands in the list instead of the
              // sheet navigating to its page: the reader asked for it from
              // the list and is still looking at the list.
              onCreated={() => undefined}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ProjectQuestsTable;
