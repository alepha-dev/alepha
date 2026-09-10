import {
  AlephaTable,
  type BulkAction,
  type BulkMenuAction,
} from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Page, z } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Bot,
  CircleDot,
  ClipboardCheck,
  Flag,
  FlagOff,
  Play,
  Plus,
  Search,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import { compareReleaseTags } from "@/api/releaseOrder.ts";
import {
  type EpicResource,
  epicResourceSchema,
} from "@/api/schemas/epicResourceSchema.ts";
import { QUEST_RELEASE_NONE } from "@/api/schemas/questReleaseFilter.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentEpicCountAtom } from "@/web/app/atoms/currentEpicCountAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { settleBulk } from "../../shared/bulkOutcome.ts";
import { formatReference } from "../../shared/element/typedReference.ts";
import FilterSlot from "../../shared/FilterSlot.tsx";
import { useBulkReport } from "../../shared/useBulkReport.ts";
import { useAgentPrompt } from "../prompts/useAgentPrompt.ts";
import { useAgentPromptSubject } from "../prompts/useAgentPromptSubject.ts";
import { releaseRowMenu } from "../releaseRowMenu.ts";
import { useReleaseCascadeToast } from "../releases/useReleaseCascadeToast.ts";
import EpicCreateSheet from "./EpicCreateSheet.tsx";
import {
  EPIC_STATUSES,
  STATUS_ICONS,
  STATUS_LABEL_KEYS,
  STATUS_ORDER,
  STATUS_TONE,
} from "./epicStatus.ts";
import ProjectEpicsProgress from "./ProjectEpicsProgress.tsx";

/**
 * Filter form, owned by AlephaTable: free-text over title + description,
 * and a status multi-select whose empty selection means "all".
 *
 * An array, like the Quests list's, because the everyday view is several
 * statuses at once (everything not yet completed, say) and a single value
 * could not say it (feedback #2069). The array is what `AlephaTable`
 * persists and carries in the URL, the same way it already does for the
 * board's four list filters.
 *
 * The status is the column's own enum rather than a list restated here, so
 * a status renamed on the entity cannot survive in a filter that no longer
 * matches anything.
 */
const epicsFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.array(epicResourceSchema.shape.status).optional(),
  /**
   * Release ids as strings, plus the `QUEST_RELEASE_NONE` sentinel, exactly
   * like the Quests table's (feedback #2102).
   *
   * ⚠️ Strings rather than numbers even though a release id is an integer:
   * the sentinel shares the list, which is what lets "unassigned, or 0.29.0"
   * be one selection. Two fields would AND where a multi-select ORs.
   *
   * Unlike the Quests table's, this one never leaves the browser -
   * `getEpics` answers with the project's whole list, so the predicate sits
   * beside `search` and `status` in `fetchEpics` rather than in a query
   * parameter.
   */
  release: z.array(z.string()).optional(),
});

/**
 * The Epics list, built on {@link AlephaTable}.
 *
 * `getEpics` returns the project's whole list in one response — an epic is
 * a bounded initiative, so a project has tens of them, not thousands — so
 * search, status filter, sort and paging are all applied client-side here
 * rather than round-tripping. Same shape as `ProjectBlights`, and the
 * reason neither needed a paginated endpoint.
 *
 * Status is a read-only CHIP here, but the row menu carries the one
 * lifecycle decision a person makes: **Mark as ready** on a `planned` epic,
 * **Back to planning** on a `ready` one (#Q2223). The other two statuses
 * happen on their own (the first accepted quest starts an epic, the last
 * resolved one completes it), so an epic that has started offers nothing.
 * Marking a whole chain ready from the list is the point: `dependsOn` gates
 * the start, not `ready`, so each epic opens when its predecessor completes.
 *
 * The labels come from `epic.status.actions.*`, the same keys the detail
 * page's control uses, so the two surfaces cannot come to call the same
 * move different things.
 *
 * ### Built to the Quests table's shape
 *
 * The four things that make `ProjectQuestsTable` scannable are deliberately
 * repeated here, because two lists of the project's work should not be read
 * two different ways:
 *
 * - the identifier is part of the name, `#12 - Title`, with only the
 *   separator muted, rather than a column of its own;
 * - the whole row is clickable, AND the title is a real anchor inside it,
 *   so a plain click routes while cmd/middle-click opens a tab;
 * - the coloured status is the first thing on the row;
 * - the status chip is `tint` + tone + glyph, not a solid fill.
 *
 * Two consequences worth knowing. The `number` column is gone, folded into
 * the title, and with it the ability to sort by epic number from the header
 * (clearing the sort still falls back to it, and the Quests table never had
 * that sort either). And the row menu's "Open" entry is gone as redundant
 * now that the row itself navigates.
 */
const ProjectEpics = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const router = useRouter<AppRouter>();
  const epicApi = useClient<EpicController>();
  const [project] = useStore(currentProjectAtom);
  const [releases] = useStore(currentReleasesAtom);
  const reportBulk = useBulkReport();
  const agentPrompt = useAgentPrompt();
  const promptSubject = useAgentPromptSubject();
  const alepha = useAlepha();
  // The write below moves the epic's quests too (#Q2111), and a row the
  // reader did not name must not move without a word.
  const reportCascade = useReleaseCascadeToast();

  const [createOpen, setCreateOpen] = useState(false);
  // Bumped after a create, which happens outside the table and so has no
  // `ctx.refresh()` of its own to call.
  const [reload, setReload] = useState(0);

  /**
   * The same write `EpicReleaseControl` makes on the epic's own page, from
   * the row menu instead. `null` detaches; an absent key would leave the
   * attachment alone, which is why the caller passes one or the other and
   * never `undefined`.
   */
  const setRelease = async (
    epic: EpicResource,
    releaseId: number | null,
    refresh: () => void,
  ) => {
    try {
      const updated = await epicApi.updateEpic({
        params: { id: epic.id },
        body: { releaseId },
      });
      // The Release column is drawn from the row, so it repaints only once
      // the fetch comes back with the new value.
      refresh();
      reportCascade(updated.releaseCascade);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * The row menu's one lifecycle write, the same `setEpicStatus` the epic
   * page's control makes. `refresh` is what repaints the status chip AND
   * recomputes the sidebar's planned-epic badge, since `fetchEpics` pushes
   * that count on every fetch.
   */
  const setStatus = async (
    epic: EpicResource,
    status: "planned" | "ready",
    refresh: () => void,
  ) => {
    try {
      await epicApi.setEpicStatus({
        params: { id: epic.id },
        body: { status },
      });
      refresh();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!project) {
    return null;
  }

  const fetchEpics = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: Record<string, any>;
  }): Promise<Page<EpicResource>> => {
    const all = await epicApi.getEpics({ params: { projectId: project.id } });

    // Push the freshest planned count to the sidebar badge, the same way
    // `ProjectBlights` pushes `openCount`. Free: `getEpics` already returns
    // the project's whole list, so no second request is needed, and counting
    // `all` rather than `rows` keeps the badge project-wide when the toolbar
    // search has narrowed the table to one row.
    //
    // Write-only through `store.set`, never `useStore`: subscribing here
    // would re-render this component on every fetch and, with an inline
    // `fetch` prop, spin the table into an infinite refetch loop.
    //
    // This is what refreshes the badge after a create or a delete: both bump
    // the table, and the table lands back here.
    alepha.store.set(currentEpicCountAtom, {
      count: all.filter((epic) => epic.status === "planned").length,
    });

    const statuses =
      (filters?.status as EpicResource["status"][] | undefined) ?? [];
    const picked = (filters?.release as string[] | undefined) ?? [];
    // The selections OR together, and the sentinel is one of them: an epic
    // matches if it is attached to a picked release, or if "No release" is
    // picked and it is attached to nothing.
    const wantsUnattached = picked.includes(QUEST_RELEASE_NONE);
    const wantedIds = new Set(
      picked.filter((v) => v !== QUEST_RELEASE_NONE).map(Number),
    );
    const needle = String(filters?.search ?? "")
      .trim()
      .toLowerCase();
    const rows = sortEpics(
      all.filter((epic) => {
        if (statuses.length > 0 && !statuses.includes(epic.status)) {
          return false;
        }
        if (picked.length > 0) {
          // `!= null` covers both spellings of "not attached" and narrows
          // the id in the same breath, so no cast is needed here.
          const match =
            epic.releaseId != null
              ? wantedIds.has(epic.releaseId)
              : wantsUnattached;
          if (!match) return false;
        }
        if (!needle) return true;
        // `#E3`, `#3` and `3` all reach the number; `needle` is lowercased,
        // so the letter is.
        return (
          epic.title.toLowerCase().includes(needle) ||
          epic.description.toLowerCase().includes(needle) ||
          String(epic.number) === needle.replace(/^#e?/, "")
        );
      }),
      sort,
      releases,
    );

    const offset = page * size;
    const content = rows.slice(offset, offset + size);
    return {
      content,
      page: {
        number: page,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
        isEmpty: content.length === 0,
        isFirst: page === 0,
        isLast: offset + size >= rows.length,
      },
    };
  };

  // Bulk over a selection, the Quests table's shape (feedback #2086). The
  // checkbox column exists because this array is not empty - `AlephaTable`
  // derives `hasCheckbox` from it - so gating an entry out on permissions
  // can leave the selection with nothing to do, which is why both are
  // pushed conditionally rather than rendered disabled.
  //
  // ⚠️ No bulk Mark as ready. The row menu keeps it because deciding that a
  // spec is done is a per-epic decision with a per-epic confirmation, and a
  // selection mixing planned, ready and started epics would have to refuse
  // most of what it held.
  //
  // Every entry refreshes and then clears, in that order: a selection that
  // survives a delete points at rows that no longer exist. `ctx.refresh()`
  // is also what repaints the sidebar's planned-epic badge, since
  // `fetchEpics` pushes that count on every fetch.
  /**
   * Every release, published included, led by a sentinel.
   *
   * ⚠️ Read this beside the bulk `Add to release` menu below, which filters
   * the SAME list the opposite way. The two rules are genuinely opposite and
   * that is why this list is built here rather than shared:
   *
   * - a FILTER reads history, so hiding what has shipped would leave the
   *   table unable to answer "what went into 0.28.0";
   * - the MENU is a picker for a write, and `ReleaseAttachmentService`
   *   refuses a published release server-side, so an entry for one could
   *   only ever fail.
   *
   * "No release" leads, because "which epics are still unassigned" is the
   * question a release planner asks most and every option being a release
   * left it unanswerable. Named that rather than "None", which in a filter
   * reads as "no filter". Same two decisions the Quests table already made
   * (feedback #2102).
   */
  const releaseOptions = [
    {
      value: QUEST_RELEASE_NONE,
      label: String(tr("board.filter.noRelease")),
    },
    ...(releases ?? []).map((release) => ({
      value: String(release.id),
      label: release.tag ?? release.title,
    })),
  ];

  const bulkActions: Array<
    BulkAction<EpicResource> | BulkMenuAction<EpicResource>
  > = [];

  if (epicApi.updateEpic.can()) {
    bulkActions.push({
      icon: Flag,
      label: tr("board.bulk.release"),
      // ⚠️ Unpublished only. The Release COLUMN below lists every release
      // because it reads history; this is a picker for a write, and
      // `ReleaseAttachmentService.resolve` refuses a published release
      // server-side. A published entry here would be an item that can only
      // fail. Same reasoning, same filter, as the Quests table's.
      items: () =>
        (releases ?? [])
          .filter((release) => !release.releasedAt)
          .map((release) => ({
            label: release.tag ?? release.title,
            onClick: async (selected, ctx) => {
              const outcome = await settleBulk(
                selected.map((epic) => epic.id),
                (id) =>
                  epicApi.updateEpic({
                    params: { id },
                    body: { releaseId: release.id },
                  }),
              );
              reportBulk(
                outcome,
                String(
                  tr("board.bulk.released", {
                    args: [
                      String(outcome.done.length),
                      release.tag ?? release.title,
                    ],
                  }),
                ),
              );
              ctx.refresh();
              ctx.clearSelection();
            },
          })),
    });
  }

  if (epicApi.deleteEpic.can()) {
    bulkActions.push({
      icon: Trash2,
      label: tr("board.bulk.delete"),
      destructive: true,
      onClick: async (selected, ctx) => {
        const n = String(selected.length);
        const confirmed = await dialog.confirm({
          title: tr("epic.bulk.delete.title", { args: [n] }),
          // The plural of the row menu's own warning, and it says the same
          // true thing: `deleteEpic` detaches the quests and folios, it
          // does not delete them.
          description: tr("epic.bulk.delete.description"),
          confirmLabel: tr("epic.bulk.delete.confirm", { args: [n] }),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
        const outcome = await settleBulk(
          selected.map((epic) => epic.id),
          (id) => epicApi.deleteEpic({ params: { id } }),
        );
        reportBulk(
          outcome,
          String(
            tr("board.bulk.deleted", { args: [String(outcome.done.length)] }),
          ),
        );
        ctx.refresh();
        ctx.clearSelection();
      },
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <AlephaTable<EpicResource>
        className="min-h-0 flex-1"
        persistenceKey={`lor.epics.${project.id}`}
        bulkActions={bulkActions}
        defaultSort={{ field: "updatedAt", direction: "desc" }}
        emptyMessage={tr("epic.list.empty")}
        refreshSignal={reload}
        filters={{
          schema: epicsFiltersSchema,
          render: (form) => (
            <>
              <FilterSlot>
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={tr("epic.filter.search")}
                  inputProps={{ "aria-label": tr("epic.filter.search") }}
                />
              </FilterSlot>
              <FilterSlot>
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel={tr("epic.filter.allStatuses")}
                  countLabel={(n) =>
                    String(tr("epic.filter.statusCount", { args: [String(n)] }))
                  }
                  triggerClassName="w-full"
                  items={EPIC_STATUSES.map((status) => ({
                    label: tr(STATUS_LABEL_KEYS[status]),
                    value: status,
                  }))}
                  inputProps={{ "aria-label": tr("epic.filter.status") }}
                />
              </FilterSlot>
              {/* Hidden until the project has a release, the way the Quests
                  table hides it: with none, the only option would be the
                  sentinel, and a filter offering one value that matches
                  everything is a control with nothing to do. */}
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
            </>
          ),
        }}
        fetch={fetchEpics}
        onRowClick={(epic) =>
          router.push("projectEpic", {
            params: { epicNumber: String(epic.number) },
          })
        }
        actions={[
          {
            icon: Plus,
            label: tr("epic.create"),
            primary: true,
            onClick: () => setCreateOpen(true),
          },
        ]}
        columns={{
          // First, like the Quests table's status dot. One chip rather than
          // a dot AND a chip: an epic has a single categorical field, so
          // splitting it across two columns would put the same fact on the
          // row twice under two headers both called Status.
          status: {
            label: tr("epic.list.column.status"),
            sortable: true,
            className: "w-32 pl-4",
            cell: (epic) => {
              const Icon = STATUS_ICONS[epic.status];
              return (
                <Badge variant="tint" tone={STATUS_TONE[epic.status]}>
                  <Icon className="size-3" />
                  {tr(STATUS_LABEL_KEYS[epic.status])}
                </Badge>
              );
            },
          },
          title: {
            label: tr("epic.list.column.title"),
            sortable: true,
            // `w-full max-w-0 min-w-48`, copied from the Quests table with
            // its reasoning: auto-layout means `max-width: 0` is what stops
            // this column claiming its content width, `width: 100%` is what
            // makes it absorb the slack, and without the pair the ellipsis
            // never fires. `min-w-48` is the floor that keeps it from
            // collapsing to nothing once the other columns fill the row.
            className: "w-full max-w-0 min-w-48",
            cell: (epic) => (
              <div className="flex flex-col overflow-hidden whitespace-nowrap">
                {/* A real anchor inside a clickable row, so the browser owns
                    cmd / shift / middle click, shows the URL on hover and
                    offers "copy link address". `stopPropagation` because the
                    row carries `onRowClick` too: without it a plain click
                    navigates twice, once through each. No `hover:underline`
                    - the row already highlights under the pointer, and the
                    Quests table reads better for leaving the title still. */}
                <Link
                  href={router.path("projectEpic", {
                    params: { epicNumber: String(epic.number) },
                  })}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-sm font-medium"
                  title={`${formatReference("epic", epic.number)} - ${epic.title}`}
                >
                  {/* The number carries the title's own colour: it is part
                      of the name, not an annotation on it. Only the
                      separator is muted. */}
                  {formatReference("epic", epic.number)}{" "}
                  <span className="text-muted-foreground">-</span> {epic.title}
                </Link>
                {epic.description ? (
                  <span className="text-muted-foreground truncate text-xs">
                    {epic.description}
                  </span>
                ) : null}
              </div>
            ),
          },
          progress: {
            label: tr("epic.list.column.progress"),
            className: "w-56",
            cell: (epic) => <ProjectEpicsProgress epic={epic} />,
          },
          // The tag, not the title: the tag is what a release is called
          // ("0.28.0"), and a column of prose titles reads as a second name
          // for the epic rather than as where it ships.
          releaseId: {
            label: tr("epic.list.column.release"),
            sortable: true,
            className: "w-32",
            cell: (epic) => {
              const release = releases?.find((r) => r.id === epic.releaseId);
              if (!release) return null;
              return (
                <Badge variant="outline" className="font-mono">
                  <Flag className="size-3" />
                  {release.tag ?? release.title}
                </Badge>
              );
            },
          },
          updatedAt: {
            label: tr("epic.list.column.updated"),
            sortable: true,
            className: "w-32",
            cell: (epic) => (
              <TimeAgo
                value={epic.updatedAt}
                className="text-muted-foreground whitespace-nowrap"
              />
            ),
          },
        }}
        rowActions={(epic) => [
          // The submenu that hands this epic to an agent. Two entries under
          // two different status gates, and the whole group behind the
          // project's `agentPrompts` option, which is off by default.
          //
          // Review is offered while the plan is still open (planned or
          // ready): once the epic is in progress its quest set is what is
          // being worked, not what is being written. Work on it is offered
          // on a ready epic, whose first accepted quest starts it, and on
          // one in progress, because a half-worked epic can be handed over.
          // NOT on a planned one: its quests refuse to be accepted, and
          // whether the spec is done is the owner's call, not the agent's.
          // A completed epic gets neither, so the group has no children and
          // `AlephaTable` renders nothing for it.
          //
          // Nothing here calls `setEpicStatus`.
          ...(agentPrompt.enabled
            ? [
                {
                  icon: Bot,
                  label: tr("agentPrompts.menu"),
                  children: [
                    ...(epic.status === "planned" || epic.status === "ready"
                      ? [
                          {
                            icon: ClipboardCheck,
                            label: tr("agentPrompts.review"),
                            onClick: (row: EpicResource) =>
                              agentPrompt.copy(
                                "epicReview",
                                promptSubject.forEpic(row),
                              ),
                          },
                        ]
                      : []),
                    ...(epic.status === "ready" || epic.status === "in_progress"
                      ? [
                          {
                            // The verb and glyph quests and feedback use for
                            // the same hand-over, as the detail page's menu
                            // does through AGENT_PROMPT_MENU_META (#P2182).
                            icon: Wrench,
                            label: tr("agentPrompts.workOnIt"),
                            onClick: (row: EpicResource) =>
                              agentPrompt.copy(
                                "epicActivate",
                                promptSubject.forEpic(row),
                              ),
                          },
                        ]
                      : []),
                  ],
                },
              ]
            : []),
          // Where this epic ships, set from the list. The Release column
          // beside it could be read and not changed, which cost a page load
          // and a trip back for a field that is one click of an already-open
          // menu (#Q2098).
          //
          // ⚠️ The rules are `EpicReleaseControl`'s, read out of
          // `releaseRowMenu` rather than restated: only open releases, plus
          // this epic's own current one so a published attachment shows
          // itself instead of reading as lost, and `locked` disabling every
          // entry when that current one is published - the same condition
          // that disables the control's trigger. The server refuses it too.
          //
          // No options means no children, which renders nothing at all: a
          // project with no open release needs no case of its own.
          ...(epicApi.updateEpic.can() &&
          releaseRowMenu(releases, epic.releaseId).options.length > 0
            ? [
                {
                  icon: Flag,
                  label: tr("epic.action.setRelease"),
                  children: [
                    ...releaseRowMenu(releases, epic.releaseId).options.map(
                      (release) => ({
                        icon: Flag,
                        label: release.tag ?? release.title,
                        checked: (row: EpicResource) =>
                          row.releaseId === release.id,
                        disabled: () =>
                          releaseRowMenu(releases, epic.releaseId).locked,
                        onClick: (
                          row: EpicResource,
                          { refresh }: { refresh: () => void },
                        ) => setRelease(row, release.id, refresh),
                      }),
                    ),
                    {
                      icon: FlagOff,
                      label: tr("epic.aside.release.none"),
                      checked: (row: EpicResource) => row.releaseId == null,
                      disabled: () =>
                        releaseRowMenu(releases, epic.releaseId).locked,
                      onClick: (
                        row: EpicResource,
                        { refresh }: { refresh: () => void },
                      ) => setRelease(row, null, refresh),
                    },
                  ],
                },
              ]
            : []),
          // The one lifecycle decision, gated on the row's own status: a
          // planned epic can be marked ready, a ready one sent back to
          // planning, and an epic that has started offers nothing, because
          // its other two moves happen on their own (#Q2223).
          ...(epic.status === "planned" && epicApi.setEpicStatus.can()
            ? [
                {
                  icon: Play,
                  label: tr("epic.status.actions.markReady"),
                  onClick: async (
                    row: EpicResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    // Same copy as the detail page's own control, from the
                    // same keys. Ready releases the epic's quests into the
                    // backlog for everybody, and the first accept freezes
                    // the plan, which is what the confirmation is for; it is
                    // not destructive, so no `destructive: true`.
                    const ok = await dialog.confirm({
                      title: tr("epic.ready.title"),
                      description: tr("epic.ready.confirm", {
                        args: [row.title],
                      }) as string,
                      confirmLabel: tr("epic.status.actions.markReady"),
                      cancelLabel: tr("common.cancel"),
                    });
                    if (!ok) return;
                    await setStatus(row, "ready", refresh);
                  },
                },
              ]
            : []),
          ...(epic.status === "ready" && epicApi.setEpicStatus.can()
            ? [
                {
                  icon: Undo2,
                  label: tr("epic.status.actions.backToPlanning"),
                  onClick: (
                    row: EpicResource,
                    { refresh }: { refresh: () => void },
                  ) => setStatus(row, "planned", refresh),
                },
              ]
            : []),
          {
            icon: Trash2,
            label: tr("epic.action.delete"),
            destructive: true,
            onClick: async (
              epic: EpicResource,
              { refresh }: { refresh: () => void },
            ) => {
              const ok = await dialog.confirm({
                title: tr("epic.delete.title"),
                description: tr("epic.delete.confirm", {
                  args: [epic.title],
                }) as string,
                confirmLabel: tr("epic.action.delete"),
                cancelLabel: tr("common.cancel"),
                destructive: true,
              });
              if (!ok) return;
              try {
                await epicApi.deleteEpic({ params: { id: epic.id } });
                toaster.success(tr("epic.toast.deleted"));
                refresh();
              } catch (error) {
                toaster.error(
                  error instanceof Error ? error.message : String(error),
                );
              }
            },
          },
        ]}
      />

      <EpicCreateSheet
        projectId={project.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={() => {
          setCreateOpen(false);
          // Refetch rather than splicing the new row in: `progress` is
          // computed server-side, and the table is sorted, filtered and
          // paged, so there is no position a client-side insert could
          // honestly claim.
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
};

export default ProjectEpics;

/**
 * Client-side sort over the full epic list. Supports the four sortable
 * columns; anything else (including no sort at all) falls back to epic
 * number ascending, which is the order `getEpics` already returns and the
 * order the numbers themselves imply.
 */
const sortEpics = (
  items: EpicResource[],
  sort?: string,
  releases?: ReleaseResource[],
): EpicResource[] => {
  const field = sort?.replace(/^-/, "");
  const dir = sort?.startsWith("-") ? -1 : 1;
  const rows = [...items];
  rows.sort((a, b) => {
    if (field === "updatedAt") {
      return (
        (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) *
        dir
      );
    }
    if (field === "title") {
      return a.title.localeCompare(b.title) * dir;
    }
    if (field === "status") {
      return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir;
    }
    if (field === "releaseId") {
      const relA = releaseOf(a, releases);
      const relB = releaseOf(b, releases);
      // Epics with no release sort LAST in both directions, so flipping the
      // arrow reorders the releases without dragging the (usually large)
      // unassigned pile through the middle of the list. A null that swaps
      // ends reads as the sort being broken rather than reversed.
      if (!relA || !relB) {
        if (!relA && !relB) return a.number - b.number;
        return relA ? -1 : 1;
      }
      // Tie-break on `number` so epics sharing a release keep a stable,
      // meaningful order instead of whatever the filter happened to produce.
      return (
        compareReleaseTags(relA.tag, relB.tag) * dir ||
        (relA.number - relB.number) * dir ||
        a.number - b.number
      );
    }
    if (field === "number") {
      return (a.number - b.number) * dir;
    }
    return a.number - b.number;
  });
  return rows;
};

/**
 * The release an epic ships in, or `undefined` when it has none.
 *
 * ⚠️ The ordering is `compareReleaseTags`, the same one the Releases table
 * uses, and never the tag as text (`0.10.0` would come before `0.9.0`). It
 * used to be the release's `number`, on the reasoning that a second answer
 * would drift from the first. That was right about the risk and wrong about
 * the fix: `number` is a `$sequence`, so it is creation order, and it only
 * matches version order while releases are created in version order. The
 * answer is now written once, in `api/releaseOrder.ts`, and imported here.
 *
 * `epic.releaseId` is not usable either: it is a row id, and nothing
 * guarantees it tracks anything.
 */
const releaseOf = (
  epic: EpicResource,
  releases?: ReleaseResource[],
): ReleaseResource | undefined => {
  if (!epic.releaseId) return undefined;
  return releases?.find((release) => release.id === epic.releaseId);
};
