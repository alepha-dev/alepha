import { FilterSlot, Button, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useClient,
  useInject,
  useQuery,
  useStore,
} from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useFieldValue, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  CalendarClock,
  ChevronDown,
  MapPin,
  Plus,
  Rows3,
  Search,
  Tag,
  User,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { KanbanController } from "@/api/controllers/KanbanController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { KanbanColumnConfig } from "@/api/services/KanbanColumnConfig.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { currentAreasAtom } from "../../atoms/currentAreasAtom.ts";
import { currentQuestAtom } from "../../atoms/currentQuestAtom.ts";
import { kanbanFiltersAtom } from "../../atoms/kanbanFiltersAtom.ts";
import { kanbanReloadAtom } from "../../atoms/kanbanReloadAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { AREA_DOT_CLASS, AreaDotColor } from "../shared/areaColor.ts";
import ToolbarSpinner from "../shared/ToolbarSpinner.tsx";
import { useProjectUsers } from "../shared/useProjectUsers.ts";
import { useQuestMutations } from "../shared/useQuestMutations.ts";
import { KanbanAging } from "./kanbanAging.ts";
import KanbanColumn, { type ColumnDescriptor } from "./KanbanColumn.tsx";
import { KanbanGrouping } from "./kanbanGrouping.ts";
import { KanbanLanes, type LaneMode } from "./kanbanLanes.ts";
import { useKanbanColumnOps } from "./useKanbanColumnOps.ts";
import { useKanbanMove } from "./useKanbanMove.ts";

/**
 * Stateless, so one instance serves every mount.
 */
const grouping = new KanbanGrouping();
const aging = new KanbanAging();
const swimlanes = new KanbanLanes();
const columnConfig = new KanbanColumnConfig();

const SUB_COLUMN_DOTS = [
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-teal-500",
];

export interface KanbanBoardProps {
  project: ProjectResource;
  quests: QuestResource[];
}

const KanbanBoard = (props: KanbanBoardProps) => {
  const { project, quests: initialQuests } = props;
  const [quests, setQuests] = useState<QuestResource[]>(initialQuests);
  const [currentAreas] = useStore(currentAreasAtom);
  const areaOptions = useMemo(
    () => (currentAreas ?? []).map((a) => ({ value: a.name, label: a.name })),
    [currentAreas],
  );
  const [storedFilters, setStoredFilters] = useStore(kanbanFiltersAtom);
  // Filters belong to the project they were chosen in. A stored selection
  // from a different project would hide most of this board with no visible
  // cause, so it reads as no filter at all.
  const seeded =
    storedFilters?.projectId === project.id
      ? storedFilters
      : { areas: [], tags: [], search: "" };

  const filterForm = useForm({
    schema: z.object({
      areas: z.array(z.text()),
      tags: z.array(z.text()),
      // Search joined the form when the raw `<input>` became a `Control`
      // (#1639). It is still written to the atom on every keystroke - by the
      // mirroring effect below rather than by an inline onChange - so the
      // persisted shape and the reset button are unchanged.
      search: z.text(),
    }),
    initialValues: {
      areas: (seeded.areas ?? []) as string[],
      tags: (seeded.tags ?? []) as string[],
      search: seeded.search ?? "",
    },
    handler: async () => {},
  });
  const [areaFilterValue] = useFieldValue(filterForm.input.areas);
  const areaFilter = (areaFilterValue as string[] | undefined) ?? [];
  const [tagFilterValue] = useFieldValue(filterForm.input.tags);
  const tagFilter = (tagFilterValue as string[] | undefined) ?? [];
  const [searchValue] = useFieldValue(filterForm.input.search);
  // The form is the live value, so a keystroke filters this render rather
  // than the one after the atom write lands.
  const search = (searchValue as string | undefined) ?? "";
  const assigneeFilter = seeded.assignee;
  const dueFilter = seeded.due;

  /**
   * One writer for the whole bar, so the stored shape can never hold half
   * of one project's filter and half of another's.
   */
  const patchFilters = (patch: Partial<typeof seeded>) => {
    setStoredFilters({
      projectId: project.id,
      areas: areaFilter,
      tags: tagFilter,
      search,
      assignee: assigneeFilter,
      due: dueFilter,
      ...patch,
    });
  };

  // The two `Control`s own their own state, so mirror their value into the
  // atom whenever it moves. Writing from an effect rather than an onChange
  // because `Control` reports through the form, not a callback.
  useEffect(() => {
    if (
      storedFilters?.projectId === project.id &&
      JSON.stringify(storedFilters.areas) === JSON.stringify(areaFilter) &&
      JSON.stringify(storedFilters.tags) === JSON.stringify(tagFilter) &&
      (storedFilters.search ?? "") === search
    ) {
      return;
    }
    patchFilters({ areas: areaFilter, tags: tagFilter, search });
  }, [areaFilter, tagFilter, search, project.id]);
  // Board-local, not persisted: collapsing is a "get this out of my way for
  // a minute" gesture, and a column still folded away three days later
  // reads as a card that vanished.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [laneMode, setLaneMode] = useState<LaneMode>("none");
  const [reloadKey] = useStore(kanbanReloadAtom);
  // The open card lives on its own route (`projectKanbanCard`), which
  // renders the sheet into this page's `NestedView`. The board only has to
  // keep its own row in step: `QuestView` writes every mutation into
  // `currentQuestAtom`, so watching it is how a card moves column without
  // either side holding a reference to the other, and without a refetch.
  const [openQuest] = useStore(currentQuestAtom);
  const router = useRouter<AppRouter>();
  const questApi = useClient<QuestController>();
  const questMutations = useQuestMutations();
  const kanbanApi = useClient<KanbanController>();
  const epicApi = useClient<EpicController>();
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const auth = useAuth();
  const dt = useInject(DateTimeProvider);
  const dndId = useId();

  /**
   * Managing columns from the board (#1511).
   *
   * Owner-only, matched to the endpoints' own gate rather than guessed at:
   * `addKanbanColumn` and its three siblings all carry `ownsAsOwner()`, so
   * offering the controls to a member would promise a 403. Same reasoning as
   * the members settings page.
   */
  // The column bar is project configuration; the cards on it are the work.
  // Two different permissions, so two flags - a Contributor rearranges cards
  // and does not rename a column.
  const canMoveCards = kanbanApi.moveQuestOnBoard.can();
  const reloadRef = useRef<() => void>(() => {});
  const columnOps = useKanbanColumnOps(project.id, () => reloadRef.current());
  const canManageColumns = columnOps.can;

  // Quiet on purpose: the tag filter simply offers nothing without them.
  const knownTags =
    useQuery(
      {
        handler: () =>
          questApi.listQuestTags({ query: { projectId: project.id } }),
        onError: () => {},
      },
      [questApi, project.id],
    ).data ?? [];

  // Only when the grouping actually needs them: the board payload carries
  // `epicId` but no title, and a board nobody is grouping by epic must not
  // pay for the lookup. Quiet: a lane without its title still groups.
  const epics = useQuery(
    {
      enabled: laneMode === "epic",
      handler: () => epicApi.getEpics({ params: { projectId: project.id } }),
      onError: () => {},
    },
    [epicApi, project.id, laneMode],
  ).data;
  const epicTitles = useMemo(
    () => new Map((epics ?? []).map((e) => [e.id, e.title])),
    [epics],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const filteredQuests = useMemo(() => {
    let out = quests;
    if (areaFilter.length > 0) {
      out = out.filter((quest) => areaFilter.includes(quest.area));
    }
    if (tagFilter.length > 0) {
      out = out.filter((quest) =>
        (quest.tags ?? []).some((tag) => tagFilter.includes(tag)),
      );
    }
    if (search.trim()) {
      // Title and `#Q12` (or the untyped `#12` and `12`), the two things a
      // person types when hunting for a card they already know exists. Not
      // the description: matching it would surface cards whose match is
      // invisible on the board. `needle` is lowercased, so the letter is.
      const needle = search.trim().toLowerCase();
      const asNumber = needle.replace(/^#q?/, "");
      out = out.filter(
        (quest) =>
          quest.title.toLowerCase().includes(needle) ||
          String(quest.shortId) === asNumber,
      );
    }
    if (assigneeFilter) {
      const target = assigneeFilter === "me" ? auth.user?.id : assigneeFilter;
      out = out.filter((quest) => quest.acceptedBy === target);
    }
    if (dueFilter) {
      const now = dt.now();
      out = out.filter((quest) => {
        if (!quest.dueAt || quest.completedAt) return false;
        const due = dt.of(quest.dueAt);
        return dueFilter === "overdue"
          ? due.isBefore(now)
          : due.diff(now, "day") <= 7;
      });
    }
    return out;
  }, [quests, areaFilter, tagFilter, search, assigneeFilter, dueFilter]);

  const filtersActive =
    areaFilter.length > 0 ||
    tagFilter.length > 0 ||
    Boolean(search.trim()) ||
    Boolean(assigneeFilter) ||
    Boolean(dueFilter);

  const subColumns = project.kanbanColumns ?? ["In Progress"];
  /**
   * Where `acceptQuest` puts a quest server-side: the project's first
   * configured column. Since #1227 that is not necessarily the first
   * ACCEPTED lane — a project can name its own backlog column and put it
   * first — so the "did it already land where the drop wanted" checks below
   * have to compare against this rather than against the first accepted
   * descriptor.
   */
  const acceptLandsIn = subColumns[0];

  /**
   * The frame, resolved rather than hardcoded (quest #1227).
   *
   * It used to be literally `New | <every configured column> | Completed`.
   * Now each configured column declares which lifecycle state it collapses
   * to, and the ends are synthesized only when the project has not named a
   * column carrying that status — so a board can have two done-ish lanes,
   * or its own backlog lane, or the old frame by configuring nothing.
   *
   * The lifecycle triple is still the truth. `kind` is the column's mapping
   * onto it, and everything downstream keeps reading the timestamps.
   */
  const columns: ColumnDescriptor[] = useMemo(() => {
    const resolved = columnConfig.resolve(project, {
      todo: tr("kanban.column.todo"),
      completed: tr("kanban.column.completed"),
    });
    let acceptedSeen = 0;
    return resolved.map((column) => ({
      // Keyed by name, which is unique among configured columns; the
      // synthesized ends carry their translated label, which cannot
      // collide because a column named "To do" would be a configured one and
      // would suppress the synthesized lane.
      key: `column:${column.name}`,
      kind: column.status,
      subColumn: column.name,
      label: column.name,
      wipLimit: column.wipLimit,
      color: column.color,
      // A synthesized end has no entry in `kanbanColumns`, so there is
      // nothing to rename, recolour or delete (#1511).
      editable: !column.synthesized,
      // The operator's token wins; without one the board derives a tint the
      // way it always has. Both go through `AREA_DOT_CLASS`, so a column and
      // an area tinted the same read the same.
      dotClass: column.color
        ? AREA_DOT_CLASS[column.color]
        : column.status === "todo"
          ? "bg-blue-500"
          : column.status === "completed"
            ? "bg-green-500"
            : SUB_COLUMN_DOTS[acceptedSeen++ % SUB_COLUMN_DOTS.length],
    }));
  }, [project.kanbanColumns, project.kanbanColumnConfig, tr]);

  const lanes = useMemo(
    () => swimlanes.build(filteredQuests, laneMode, epicTitles),
    [filteredQuests, laneMode, epicTitles],
  );

  /**
   * One bucket map per lane. Column droppable ids are prefixed with the
   * lane key, because two lanes showing "In progress" are two distinct drop
   * targets — dnd-kit would otherwise see one id registered twice and
   * deliver every drop to whichever registered last.
   */
  const laneGroups = useMemo(
    () =>
      lanes.map((lane) => ({
        lane,
        grouped: grouping.group(lane.quests, columns),
      })),
    [lanes, columns],
  );

  // The flat view still needs one `grouped` for the drag handler's
  // same-column check, which reasons about the board as a whole.
  const grouped = useMemo(
    () => grouping.group(filteredQuests, columns),
    [filteredQuests, columns],
  );

  const areaColor = useMemo(
    () => new AreaDotColor(currentAreas),
    [currentAreas],
  );

  // One fetch for the whole board rather than one per card. Enabled only
  // when something is actually assigned: an untouched backlog is every
  // card unassigned, and the avatars would cost a request for nothing.
  const members = useProjectUsers(quests.some((q) => !!q.acceptedBy));
  const membersById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  /**
   * Quests whose predecessor is not complete, by the questline map's own
   * `waiting` rule: a `todo` quest whose `dependsOn` is unfinished, or is
   * outside the set we can see — the blocker exists either way.
   *
   * Derived from the UNFILTERED board, not `filteredQuests`: a tag filter
   * that happens to hide the blocker must not make a blocked card look
   * ready.
   */
  const blockedIds = useMemo(() => {
    const byId = new Map(quests.map((q) => [q.id, q]));
    const blocked = new Set<number>();
    for (const quest of quests) {
      if (quest.metadata.status !== "todo" || quest.dependsOn == null) continue;
      const parent = byId.get(quest.dependsOn);
      if (!parent || parent.metadata.status !== "completed") {
        blocked.add(quest.id);
      }
    }
    return blocked;
  }, [quests]);

  /**
   * A fresh board, into local state.
   *
   * An action rather than a keyed `useQuery`, on purpose: drops patch
   * `quests` optimistically, and a query's data would have to be patched
   * through the cache instead. Always called through `refetch`, which
   * supersedes a reload in flight rather than dropping the newer one.
   */
  const reloadAction = useAction<[], void>(
    {
      handler: async ({ signal }) => {
        const data = await kanbanApi.getBoard({
          params: { projectId: project.id },
        });
        if (!signal.aborted) setQuests(data.quests);
      },
    },
    [kanbanApi, project.id],
  );
  const loading = reloadAction.loading;

  // Filled here rather than passed directly to `useKanbanColumnOps` above:
  // that hook is declared before `reloadAction` exists, and reading the
  // binding there is a use-before-initialisation the linter refuses.
  reloadRef.current = () => void reloadAction.refetch();

  useEffect(() => {
    if (reloadKey?.key) void reloadAction.refetch();
  }, [reloadKey]);

  useEffect(() => {
    if (!openQuest) return;
    // Patch in place rather than reload: the sheet is the only thing that
    // changed, and a refetch would blank the board behind it.
    // oxlint-disable-next-line react/set-state-in-effect
    setQuests((prev) =>
      prev.some((q) => q.id === openQuest.id)
        ? prev.map((q) => (q.id === openQuest.id ? openQuest : q))
        : prev,
    );
  }, [openQuest]);

  /**
   * Create a card from a column's inline composer.
   *
   * Only the title is asked for; everything else takes a default and is
   * edited from the card back.
   *
   * ⚠️ `area` is required by `questCreateSchema`, and `QuestService`
   * registers whatever arrives into the `areas` table — the project's
   * single source of truth for areas. So the composer must never invent a
   * name: it uses the active area filter when one is set (you are looking
   * at that slice, so that is the slice you are adding to), and the
   * project's first existing area otherwise. With no areas at all there is
   * nothing honest to send, so the composer says so rather than creating
   * one nobody asked for.
   */
  const composeAction = useAction<
    [descriptor: ColumnDescriptor, title: string, position: "head" | "foot"],
    boolean
  >(
    {
      handler: async (descriptor, title, position) => {
        const area = areaFilter[0] ?? currentAreas?.[0]?.name;
        if (!area) {
          toaster.show(tr("kanban.composer.needsArea"), "warning");
          return false;
        }

        const created = await questApi.createQuest({
          body: {
            projectId: project.id,
            title,
            description: "",
            area,
            priority: "medium",
            objectives: [],
          },
        });

        // A quest is born `todo`. Landing it in an accepted lane is a second
        // call, the same two-step the drag handler makes.
        if (descriptor.kind === "in_progress") {
          await questMutations.accept(created.id);
          if (descriptor.subColumn && descriptor.subColumn !== acceptLandsIn) {
            await questApi.setQuestKanbanColumn({
              params: { id: created.id },
              body: { kanbanColumn: descriptor.subColumn },
            });
          }
        }

        // Place it where it was composed rather than wherever the default sort
        // puts it — which is the whole point of composing at a specific end.
        const siblings = grouped[descriptor.key] ?? [];
        if (siblings.length > 0) {
          await kanbanApi.moveQuestOnBoard({
            params: { id: created.id },
            body:
              position === "head"
                ? { afterQuestId: siblings[0].id }
                : { beforeQuestId: siblings[siblings.length - 1].id },
          });
        }

        await reloadAction.refetch();
        return true;
      },
    },
    [questApi, kanbanApi, questMutations, project.id, toaster, tr],
  );

  const openCard = (quest: QuestResource) => {
    void router.push("projectKanbanCard", {
      params: { projectSlug: project.slug, shortId: String(quest.shortId) },
    });
  };

  /**
   * A drop, as one action: the rollback, the fall-through from a card drop to
   * a column move and the reload after it live in `useKanbanMove`.
   */
  const move = useKanbanMove({
    quests,
    setQuests,
    grouped,
    columns,
    acceptLandsIn,
    reload: () => reloadAction.refetch(),
  });

  return (
    <div
      data-testid="kanban-board"
      className="flex flex-1 flex-col overflow-hidden"
    >
      {/* Filter nav */}
      {/* ⚠️ `flex-wrap` and `shrink-0` are the fix for the bar being clipped
          out of reach at phone widths, and the wrap is deliberate rather than
          a scroll.

          The row is a flex line of two items that both refuse to shrink: the
          form because a `FilterSlot` owns a fixed width, the toggle group
          because its buttons are `whitespace-nowrap`. The board's own
          container is `overflow-hidden` and this row is `overflow-x: visible`,
          so anything past the right edge was clipped with NO scrollbar.
          Measured at 411x845: `clientWidth 409`, `scrollWidth 678`, with
          `My cards`, `Overdue` and `No lanes` entirely off-screen. Still
          broken at 768px, because the sidebar returns at `md` and takes the
          width with it.

          Wrapping, not `overflow-x-auto`, because these filters PERSIST
          (`kanbanFiltersAtom`): a phone can inherit a filtered board from a
          desktop session, and a filter that is set and merely scrolled out of
          sight is a board that looks broken with no visible cause. Wrapping
          keeps every one of them on screen. The bar has no fixed height to
          fight, so a second row costs only vertical space.

          The wrap is automatic rather than breakpointed: a flex line breaks on
          each item's hypothetical main size, which for both of these is their
          content width, so the bar is one row exactly while one row fits. The
          toggle group wraps for the same reason - with the reset button
          showing, the group alone outgrows a 375px phone.

          `shrink-0` because the bar is a flex item in a column: at two rows,
          without it, a height-constrained board squeezes the bar instead of
          itself. */}
      <div className="border-border bg-card flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        {/* The same widget the quests table's toolbar renders: a `Control`
            per filter, in a `FilterSlot` that owns the width. Both bars
            filter the same fields, and the icons were already matched on
            that argument - it covers the whole control, not just the glyph.
            The bar around them stays this app's own: the table's toolbar is
            a chunky panel above a grid, this is a dense strip under the
            page header. */}
        <form
          {...filterForm.props}
          className="flex flex-1 flex-wrap items-center gap-2"
        >
          <FilterSlot>
            <Control
              input={filterForm.input.search}
              label=""
              icon={Search}
              placeholder={tr("kanban.filter.search")}
              inputProps={{
                "aria-label": tr("kanban.filter.search"),
                "data-testid": "kanban-search",
              }}
            />
          </FilterSlot>
          {areaOptions.length > 0 && (
            <FilterSlot>
              <Control
                input={filterForm.input.areas}
                label=""
                clearable
                icon={MapPin}
                clearLabel={tr("kanban.filter.allAreas")}
                triggerClassName="w-full"
                items={areaOptions}
                inputProps={{
                  "aria-label": tr("kanban.filter.allAreas"),
                }}
              />
            </FilterSlot>
          )}
          {knownTags.length > 0 && (
            <FilterSlot>
              <Control
                input={filterForm.input.tags}
                label=""
                clearable
                icon={Tag}
                clearLabel={tr("kanban.filter.allTags")}
                triggerClassName="w-full"
                items={knownTags.map((t) => ({ value: t, label: t }))}
                inputProps={{
                  "aria-label": tr("kanban.filter.allTags"),
                }}
              />
            </FilterSlot>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-1">
          {/* "My cards" is the filter people reach for most and the only one
              that needs no picker, so it gets a button of its own rather
              than a row in the assignee menu. */}
          <Button
            variant={assigneeFilter === "me" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            aria-pressed={assigneeFilter === "me"}
            data-testid="kanban-filter-mine"
            onClick={() =>
              patchFilters({
                assignee: assigneeFilter === "me" ? undefined : "me",
              })
            }
          >
            <User className="size-3.5" />
            {tr("kanban.filter.mine")}
          </Button>

          <Button
            variant={dueFilter ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            aria-pressed={Boolean(dueFilter)}
            data-testid="kanban-filter-due"
            onClick={() =>
              patchFilters({
                // Off → overdue → due this week → off. One button rather
                // than a select: three states people cycle, not a taxonomy.
                due:
                  dueFilter === undefined
                    ? "overdue"
                    : dueFilter === "overdue"
                      ? "week"
                      : undefined,
              })
            }
          >
            <CalendarClock className="size-3.5" />
            {dueFilter === "week"
              ? tr("kanban.filter.dueWeek")
              : tr("kanban.filter.overdue")}
          </Button>

          {/* Lanes: off → by area → by epic → off. A flat board stops being
              readable past a hundred cards, and lanes put the shape of the
              work back without changing what a column means. */}
          <Button
            variant={laneMode === "none" ? "ghost" : "secondary"}
            size="sm"
            className="h-7 text-xs"
            aria-pressed={laneMode !== "none"}
            data-testid="kanban-lanes"
            onClick={() =>
              setLaneMode((mode) =>
                mode === "none" ? "area" : mode === "area" ? "epic" : "none",
              )
            }
          >
            <Rows3 className="size-3.5" />
            {laneMode === "area"
              ? tr("kanban.lanes.byArea")
              : laneMode === "epic"
                ? tr("kanban.lanes.byEpic")
                : tr("kanban.lanes.off")}
          </Button>

          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-7 text-xs"
              data-testid="kanban-filter-reset"
              onClick={() => {
                // All three, and the form is the source for all three now.
                filterForm.input.areas.set([]);
                filterForm.input.tags.set([]);
                filterForm.input.search.set("");
                setStoredFilters({
                  projectId: project.id,
                  areas: [],
                  tags: [],
                  search: "",
                });
              }}
            >
              <X className="size-3.5" />
              {tr("kanban.filter.reset")}
            </Button>
          )}

          <ToolbarSpinner loading={loading} className="size-3.5" />
        </div>
      </div>

      {/*
        Columns. `overflow-x-auto` rather than `overflow-hidden`: seven
        columns (New + five sub-columns + Completed) need 1820px of
        `min-w-[260px]` children, which flex cannot shrink below, so on a
        laptop the rightmost ones were clipped with no way to reach them.
        Do not centre this row — `Questline` learned the same lesson: auto
        margins collapse to zero once the content outgrows the panel, but a
        centring flex alignment keeps the first column clipped out of reach
        on both sides.

        `overflow-y-hidden` is explicit because setting only `overflow-x`
        computes `overflow-y` to `auto`, which would put a second scrollbar
        on the row beside the one each column body already has.
      */}
      <DndContext
        id={dndId}
        sensors={sensors}
        onDragEnd={(event) => void move.run(event)}
      >
        {/*
          ⚠️ The lane stack scrolls, and ONLY when there are lanes.

          `DndContext` renders no DOM node, so before this the lanes were
          direct children of the board root, which is `overflow-hidden`. A
          grouped lane is `shrink-0` and takes its tallest column's height,
          so lanes stacked past the viewport inside a container that clips
          them, with nothing between to scroll and no scrollbar to say
          anything was missing. Grouping by epic on a real project produces
          23 lanes: the feature was not degraded, it was unusable.

          The column body's own `overflow-y-auto` cannot help there. It caps
          nothing in an auto-height parent, which is exactly why flat mode
          worked by accident: its single lane is `flex-1`, so the ROOT caps
          it and each column scrolls inside that.

          Hence the branch. In flat mode this stays a transparent flex level
          passing the cap through, because a y-scroll here would put a second
          scrollbar on the board beside the one each column already has -
          the trap the columns row below documents for the x axis.
        */}
        <div
          data-testid="kanban-lane-stack"
          className={
            laneMode === "none"
              ? "flex min-h-0 flex-1 flex-col"
              : "flex min-h-0 flex-1 flex-col overflow-y-auto"
          }
        >
          {laneGroups.map(({ lane, grouped: laneGrouped }, laneIndex) => {
            const laneCollapsed = collapsedLanes.has(lane.key);
            return (
              <div
                key={lane.key || "all"}
                data-testid={laneMode === "none" ? undefined : "kanban-lane"}
                data-lane={lane.key}
                className={
                  laneMode === "none"
                    ? "flex min-h-0 flex-1 flex-col"
                    : "flex min-h-0 shrink-0 flex-col"
                }
              >
                {laneMode !== "none" && (
                  <button
                    type="button"
                    data-testid="kanban-lane-header"
                    aria-expanded={!laneCollapsed}
                    onClick={() =>
                      setCollapsedLanes((prev) => {
                        const next = new Set(prev);
                        if (!next.delete(lane.key)) next.add(lane.key);
                        return next;
                      })
                    }
                    className="border-border hover:bg-hover flex w-full shrink-0 items-center gap-2 border-b px-3 py-1.5 text-left transition-colors"
                  >
                    <ChevronDown
                      className={`text-muted-foreground size-3.5 shrink-0 transition-transform ${
                        laneCollapsed ? "-rotate-90" : ""
                      }`}
                    />
                    {/* The same area token the questline map and the card
                      dot render, so one area is one colour everywhere. */}
                    {lane.areaName && (
                      <span
                        className={`size-2 shrink-0 rounded-full ${areaColor.dotClass(lane.areaName)}`}
                      />
                    )}
                    <span className="truncate text-sm font-semibold">
                      {lane.label}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {lane.quests.length}
                    </span>
                  </button>
                )}

                {!laneCollapsed && (
                  <div
                    data-testid="kanban-columns"
                    className="flex flex-1 overflow-x-auto overflow-y-hidden"
                  >
                    {columns.map((descriptor, idx) => {
                      // Lane-scoped identity: the droppable id has to be
                      // unique across the whole board, but `kind` and
                      // `subColumn` stay untouched so the drag handler's
                      // lifecycle logic does not learn about lanes at all.
                      const scoped = lane.key
                        ? {
                            ...descriptor,
                            key: `${lane.key}|${descriptor.key}`,
                          }
                        : descriptor;
                      return (
                        <KanbanColumn
                          // A Done card cannot be dragged at all: there is
                          // nowhere for it to go since reopen was deleted,
                          // and refusing the gesture before the user commits
                          // to it beats catching it after the drop.
                          //
                          // Nor while a move runs: `run()` would drop a
                          // second drag in silence, so the cards are held
                          // until the first one lands (#E59 rule 10).
                          draggable={
                            canMoveCards &&
                            descriptor.kind !== "completed" &&
                            !move.loading
                          }
                          key={scoped.key}
                          descriptor={scoped}
                          quests={laneGrouped[descriptor.key] ?? []}
                          onSelect={openCard}
                          areaDotClass={(area) => areaColor.dotClass(area)}
                          tagColors={project.tagColors}
                          blockedIds={blockedIds}
                          agingOf={(q) => aging.levelOf(q, dt)}
                          collapsed={collapsed.has(scoped.key)}
                          onToggleCollapsed={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (!next.delete(scoped.key))
                                next.add(scoped.key);
                              return next;
                            })
                          }
                          onCompose={
                            descriptor.kind === "completed"
                              ? undefined
                              : (title, position) =>
                                  composeAction.run(descriptor, title, position)
                          }
                          composing={composeAction.loading}
                          assigneeOf={(q) =>
                            q.acceptedBy
                              ? membersById.get(q.acceptedBy)
                              : undefined
                          }
                          busy={columnOps.loading}
                          onRename={
                            canManageColumns
                              ? (name) =>
                                  void columnOps.rename(descriptor.label, name)
                              : undefined
                          }
                          onColor={
                            canManageColumns
                              ? (color) =>
                                  void columnOps.setColor(
                                    descriptor.label,
                                    color,
                                  )
                              : undefined
                          }
                          onDelete={
                            canManageColumns
                              ? () => void columnOps.remove(descriptor.label)
                              : undefined
                          }
                          last={idx === columns.length - 1}
                        />
                      );
                    })}
                    {/* After the last column, and only on the first lane: the
                      board repeats its columns per swimlane, so one control
                      per lane would offer the same single action several
                      times over. Adding is capped at five by the server, and
                      the control simply goes away at the cap rather than
                      offering a refusal. */}
                    {canManageColumns &&
                      laneIndex === 0 &&
                      columns.filter((c) => c.editable).length < 5 && (
                        <button
                          type="button"
                          data-testid="kanban-column-add"
                          disabled={columnOps.loading}
                          onClick={() =>
                            void columnOps.add(
                              tr("kanban.column.addDefault", {
                                args: [
                                  String(
                                    columns.filter((c) => c.editable).length +
                                      1,
                                  ),
                                ],
                              }),
                            )
                          }
                          className="text-muted-foreground hover:text-foreground hover:bg-hover border-border flex w-10 shrink-0 flex-col items-center gap-2 border-l py-2 text-xs transition-colors disabled:opacity-50"
                        >
                          <Plus className="size-4" />
                          <span
                            className="truncate font-medium"
                            style={{ writingMode: "vertical-rl" }}
                          >
                            {tr("kanban.column.add")}
                          </span>
                        </button>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DndContext>

      {/*
        The quest sheet used to live here, over local `selectedQuest` state:
        no URL, no refetch, so a long-lived board edited whatever `getBoard`
        returned however long ago. It is `ProjectKanbanCard` on its own
        route now, rendered into this page's `NestedView` — see `openCard`
        above and the `currentQuestAtom` effect that keeps the row in step.
      */}
    </div>
  );
};

export default KanbanBoard;
