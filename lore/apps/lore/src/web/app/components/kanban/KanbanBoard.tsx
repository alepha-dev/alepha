import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useFieldValue, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  CalendarClock,
  ChevronDown,
  Loader2,
  Rows3,
  Search,
  User,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

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
import { AreaDotColor } from "../shared/areaColor.ts";
import { useProjectUsers } from "../shared/useProjectUsers.ts";
import { useQuestMutations } from "../shared/useQuestMutations.ts";
import { KanbanAging } from "./kanbanAging.ts";
import KanbanColumn, {
  type ColumnDescriptor,
  type ColumnKind,
} from "./KanbanColumn.tsx";
import { KanbanGrouping } from "./kanbanGrouping.ts";
import { KanbanLanes, type LaneMode } from "./kanbanLanes.ts";

type QuestStatus = "new" | "accepted" | "completed";

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
  const [loading, setLoading] = useState(false);
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
    }),
    initialValues: {
      areas: (seeded.areas ?? []) as string[],
      tags: (seeded.tags ?? []) as string[],
    },
    handler: async () => {},
  });
  const [areaFilterValue] = useFieldValue(filterForm.input.areas);
  const areaFilter = (areaFilterValue as string[] | undefined) ?? [];
  const [tagFilterValue] = useFieldValue(filterForm.input.tags);
  const tagFilter = (tagFilterValue as string[] | undefined) ?? [];
  const search = seeded.search ?? "";
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
      JSON.stringify(storedFilters.tags) === JSON.stringify(tagFilter)
    ) {
      return;
    }
    patchFilters({ areas: areaFilter, tags: tagFilter });
  }, [areaFilter, tagFilter, project.id]);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  // Board-local, not persisted: collapsing is a "get this out of my way for
  // a minute" gesture, and a column still folded away three days later
  // reads as a card that vanished.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [laneMode, setLaneMode] = useState<LaneMode>("none");
  const [epicTitles, setEpicTitles] = useState<Map<number, string>>(new Map());
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
  const dialog = useDialog();
  const auth = useAuth();
  const dt = useInject(DateTimeProvider);
  const dndId = useId();

  useEffect(() => {
    questApi
      .listQuestTags({ query: { projectId: project.id } })
      .then(setKnownTags)
      .catch(() => null);
  }, [project.id]);

  // Only when the grouping actually needs them: the board payload carries
  // `epicId` but no title, and a board nobody is grouping by epic must not
  // pay for the lookup.
  useEffect(() => {
    if (laneMode !== "epic") return;
    let alive = true;
    epicApi
      .getEpics({ params: { projectId: project.id } })
      .then((epics) => {
        if (alive) {
          setEpicTitles(new Map(epics.map((e) => [e.id, e.title])));
        }
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [laneMode, project.id]);

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
      // Title and `#shortId`, the two things a person types when hunting
      // for a card they already know exists. Not the description: matching
      // it would surface cards whose match is invisible on the board.
      const needle = search.trim().toLowerCase();
      const asNumber = needle.replace(/^#/, "");
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
      new: String(tr("kanban.column.new")),
      completed: String(tr("kanban.column.completed")),
    });
    let acceptedSeen = 0;
    return resolved.map((column) => ({
      // Keyed by name, which is unique among configured columns; the
      // synthesized ends carry their translated label, which cannot
      // collide because a column named "New" would be a configured one and
      // would suppress the synthesized lane.
      key: `column:${column.name}`,
      kind: column.status,
      subColumn: column.name,
      label: column.name,
      wipLimit: column.wipLimit,
      dotClass:
        column.status === "new"
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
   * `waiting` rule: a `new` quest whose `dependsOn` is unfinished, or is
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
      if (quest.metadata.status !== "new" || quest.dependsOn == null) continue;
      const parent = byId.get(quest.dependsOn);
      if (!parent || parent.metadata.status !== "completed") {
        blocked.add(quest.id);
      }
    }
    return blocked;
  }, [quests]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await kanbanApi.getBoard({
        params: { projectId: project.id },
      });
      setQuests(data.quests);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because the loader flips
    // `loading` before its first await.
    // oxlint-disable-next-line react/set-state-in-effect
    if (reloadKey?.key) void reload();
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
  const handleCompose = async (
    descriptor: ColumnDescriptor,
    title: string,
    position: "head" | "foot",
  ) => {
    const area = areaFilter[0] ?? currentAreas?.[0]?.name;
    if (!area) {
      toaster.show(tr("kanban.composer.needsArea"), "warning");
      return;
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

    // A quest is born `new`. Landing it in an accepted lane is a second
    // call, the same two-step the drag handler makes.
    if (descriptor.kind === "accepted") {
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

    await reload();
  };

  const openCard = (quest: QuestResource) => {
    void router.push("projectKanbanCard", {
      params: { projectSlug: project.slug, shortId: String(quest.shortId) },
    });
  };

  /**
   * Drop onto another card: place the dragged card immediately above it.
   *
   * Only within one column. A card dropped onto a card in a DIFFERENT
   * column falls through to the column handler below, because crossing
   * columns is a lifecycle transition first and a position second — and
   * answering both from one gesture would make an accept depend on where
   * in the lane the cursor happened to be.
   */
  const handleCardDrop = async (
    quest: QuestResource,
    target: QuestResource,
  ): Promise<boolean> => {
    const columnKey = Object.keys(grouped).find((key) =>
      grouped[key].some((row) => row.id === target.id),
    );
    const column = columnKey ? grouped[columnKey] : undefined;
    if (!column || !column.some((row) => row.id === quest.id)) {
      return false;
    }

    // Neighbours as they will be once the card has left its old slot, which
    // is what the server ranks between.
    const without = column.filter((row) => row.id !== quest.id);
    const targetIndex = without.findIndex((row) => row.id === target.id);
    if (targetIndex === -1) return false;
    const before = without[targetIndex - 1];
    const after = without[targetIndex];
    if (before?.id === quest.id) return false;

    // Optimistic: the card follows the cursor's release. Reordering used to
    // cost a full board refetch per drop, which blanked every column for the
    // length of a round trip.
    const previous = quests;
    const reordered = [...without];
    reordered.splice(targetIndex, 0, quest);
    setQuests((all) => [
      ...all.filter((row) => !reordered.some((r) => r.id === row.id)),
      ...reordered,
    ]);

    try {
      const updated = await kanbanApi.moveQuestOnBoard({
        params: { id: quest.id },
        body: { beforeQuestId: before?.id, afterQuestId: after?.id },
      });
      // The server is the authority on the rank it minted, and the ranks it
      // may have just backfilled across the rest of the column — so take a
      // fresh board rather than trusting the local splice.
      await reload();
      return Boolean(updated);
    } catch (error: any) {
      setQuests(previous);
      toaster.show(error?.message || tr("kanban.error.actionFailed"), "danger");
      return true;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const questData = active.data.current;
    const columnData = over.data.current;
    if (questData?.type !== "quest") return;

    // Dropped onto another card — a position within a column.
    if (columnData?.type === "card") {
      const target = columnData.quest as QuestResource;
      const dragged = questData.quest as QuestResource;
      if (target.id === dragged.id) return;
      if (await handleCardDrop(dragged, target)) return;
      // Not a same-column drop: fall through and treat it as a drop on the
      // target's column, which is the lifecycle move it really is.
    }

    if (columnData?.type !== "column" && columnData?.type !== "card") return;

    const quest = questData.quest as QuestResource;
    const fromStatus = quest.metadata.status as QuestStatus;
    // A column droppable names its own lane; a card droppable does not, so
    // read the lane off the card that was landed on.
    const target =
      columnData.type === "card"
        ? (columnData.quest as QuestResource)
        : undefined;
    const toKind = (
      target ? target.metadata.status : columnData.kind
    ) as ColumnKind;
    const toSubColumn = (
      target ? target.kanbanColumn : columnData.subColumn
    ) as string | undefined;

    // No-op if the card was dropped onto its current column.
    if (fromStatus === toKind) {
      if (toKind !== "accepted") return;
      if (quest.kanbanColumn === toSubColumn) return;
    }

    // WIP limits are SOFT (#1228). A hard block on your own board is a
    // tool arguing with you, so this warns and proceeds — the point of the
    // limit is to make the overload visible, not to police it.
    const targetColumn = columns.find(
      (col) => col.kind === toKind && col.subColumn === toSubColumn,
    );
    if (
      targetColumn?.wipLimit != null &&
      (grouped[targetColumn.key]?.length ?? 0) >= targetColumn.wipLimit &&
      // Only when the card is arriving from somewhere else: shuffling
      // within an already-full column does not make it fuller.
      !grouped[targetColumn.key]?.some((row) => row.id === quest.id)
    ) {
      toaster.show(
        String(
          tr("kanban.wip.exceeded", {
            args: [targetColumn.label, String(targetColumn.wipLimit)],
          }),
        ),
        "warning",
      );
    }

    // Done → anywhere is a reopen. It used to be refused outright
    // (`kanban.error.completedCannotMove`), which is right for a quest log
    // and wrong for a board: pulling a card back out of Done is routine.
    //
    // Confirmed rather than silent, because reopening a predecessor turns
    // its dependents from ready back to waiting — and a dependent already
    // accepted on the strength of this completion STAYS accepted. That is
    // worth saying out loud rather than blocking.
    if (fromStatus === "completed") {
      const dependents = quests.filter(
        (row) => row.dependsOn === quest.id && !row.completedAt,
      );
      const ok = await dialog.confirm({
        title: tr("kanban.reopen.title"),
        description: dependents.length
          ? tr("kanban.reopen.confirmWithDependents", {
              args: [dependents.map((d) => `#${d.shortId}`).join(", ")],
            })
          : tr("kanban.reopen.confirm"),
        confirmLabel: tr("kanban.reopen.confirmButton"),
        cancelLabel: tr("common.cancel"),
      });
      if (!ok) return;
    }

    if (fromStatus === "new" && toKind === "completed") {
      toaster.show(tr("kanban.error.acceptFirst"), "warning");
      return;
    }

    // Optimistic: paint the destination before the round trip. The board
    // used to `await reload()` after every drop, so a card sat in its old
    // column for the length of a request and then teleported. The reload
    // still happens afterwards — a transition can change more than the
    // column (an accept stamps the assignee, a complete stamps the
    // timestamp) — but it is no longer what the eye is waiting for.
    const before = quests;
    setQuests((prev) =>
      prev.map((row) =>
        row.id === quest.id
          ? {
              ...row,
              metadata: { ...row.metadata, status: toKind },
              kanbanColumn: toKind === "accepted" ? toSubColumn : undefined,
            }
          : row,
      ),
    );

    try {
      // Every branch goes through `useQuestMutations`, which owns what each
      // transition does to the Quest Log and the sidebar badge. Dragging is
      // the surface where that mattered most and was answered least: a
      // board accept never reached the assigned list at all, and a board
      // completion never refreshed the count.
      if (fromStatus === "new" && toKind === "accepted") {
        // Accept the quest then (if needed) move it to the chosen sub-column;
        // acceptQuest drops it in the first column by default.
        await questMutations.accept(quest.id);
        if (toSubColumn && toSubColumn !== acceptLandsIn) {
          await questApi.setQuestKanbanColumn({
            params: { id: quest.id },
            body: { kanbanColumn: toSubColumn },
          });
        }
      } else if (fromStatus === "accepted" && toKind === "new") {
        await questMutations.unassign(quest.id);
      } else if (fromStatus === "accepted" && toKind === "accepted") {
        if (!toSubColumn) return;
        await questApi.setQuestKanbanColumn({
          params: { id: quest.id },
          body: { kanbanColumn: toSubColumn },
        });
      } else if (fromStatus === "accepted" && toKind === "completed") {
        await questMutations.complete(quest.id, {});
      } else if (fromStatus === "completed") {
        // Reopening lands the card in the first sub-column, so a drop onto
        // a different lane needs a second call to place it there.
        await questApi.reopenQuest({ params: { id: quest.id } });
        if (
          toKind === "accepted" &&
          toSubColumn &&
          toSubColumn !== acceptLandsIn
        ) {
          await questApi.setQuestKanbanColumn({
            params: { id: quest.id },
            body: { kanbanColumn: toSubColumn },
          });
        } else if (toKind === "new") {
          await questMutations.unassign(quest.id);
        }
      }
      await reload();
    } catch (error: any) {
      // Put the card back where it was: the server refused, so the
      // optimistic position is a lie.
      setQuests(before);
      toaster.show(error?.message || tr("kanban.error.actionFailed"), "danger");
    }
  };

  return (
    <div
      data-testid="kanban-board"
      className="flex flex-1 flex-col overflow-hidden"
    >
      {/* Filter nav */}
      <div className="border-border bg-card flex items-center gap-2 border-b px-3 py-1.5">
        {loading && (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
        )}
        <form {...filterForm.props} className="flex flex-1 items-center gap-2">
          {areaOptions.length > 0 && (
            <div className="w-64 max-w-full">
              <Control
                input={filterForm.input.areas}
                label=""
                clearable
                clearLabel={tr("kanban.filter.allAreas")}
                items={areaOptions}
              />
            </div>
          )}
          {knownTags.length > 0 && (
            <div className="w-64 max-w-full">
              <Control
                input={filterForm.input.tags}
                label=""
                clearable
                clearLabel={tr("kanban.filter.allTags")}
                items={knownTags.map((t) => ({ value: t, label: t }))}
              />
            </div>
          )}
        </form>

        <div className="flex items-center gap-1">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              data-testid="kanban-search"
              placeholder={String(tr("kanban.filter.search"))}
              aria-label={String(tr("kanban.filter.search"))}
              className="border-border bg-background focus-visible:ring-ring h-7 w-44 rounded-md border pr-2 pl-7 text-xs focus-visible:ring-2 focus-visible:outline-none"
              onChange={(e) => patchFilters({ search: e.currentTarget.value })}
            />
          </div>

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
                filterForm.input.areas.set([]);
                filterForm.input.tags.set([]);
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
      <DndContext id={dndId} sensors={sensors} onDragEnd={handleDragEnd}>
        {laneGroups.map(({ lane, grouped: laneGrouped }) => {
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
                  className="border-border hover:bg-muted flex w-full shrink-0 items-center gap-2 border-b px-3 py-1.5 text-left transition-colors"
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
                      ? { ...descriptor, key: `${lane.key}|${descriptor.key}` }
                      : descriptor;
                    return (
                      <KanbanColumn
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
                            if (!next.delete(scoped.key)) next.add(scoped.key);
                            return next;
                          })
                        }
                        onCompose={
                          descriptor.kind === "completed"
                            ? undefined
                            : (title, position) =>
                                handleCompose(descriptor, title, position)
                        }
                        assigneeOf={(q) =>
                          q.acceptedBy
                            ? membersById.get(q.acceptedBy)
                            : undefined
                        }
                        last={idx === columns.length - 1}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
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
