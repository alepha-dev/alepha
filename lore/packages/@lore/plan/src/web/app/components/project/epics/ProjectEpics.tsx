import { TimeAgo, Badge, useDialog } from "@alepha/ui";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
  type BulkAction,
  type BulkActionContext,
  type BulkMenuAction,
  type RowActionContext,
} from "@alepha/ui/table";
import {
  currentProjectAtom,
  type I18n,
  settleBulk,
  formatReference,
  useBulkReport,
  useOptimisticWrite,
  useAgentPrompt,
} from "@lore/core/web";
import { type Page, z } from "alepha";
import {
  useAction,
  useAlepha,
  useClient,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  Bot,
  CircleCheck,
  CircleDot,
  ClipboardCheck,
  Flag,
  FlagOff,
  MessageCircleQuestion,
  NotebookPen,
  Play,
  Plus,
  Trash2,
  OctagonAlert,
  TriangleAlert,
  Undo2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import type { EpicController } from "../../../../../api/controllers/EpicController.ts";
import { compareReleaseTags } from "../../../../../api/releaseOrder.ts";
import {
  type EpicResource,
  epicResourceSchema,
} from "../../../../../api/schemas/epicResourceSchema.ts";
import { QUEST_RELEASE_NONE } from "../../../../../api/schemas/questReleaseFilter.ts";
import type { ReleaseResource } from "../../../../../api/schemas/releaseResourceSchema.ts";
import { currentEpicCountAtom } from "../../../atoms/currentEpicCountAtom.ts";
import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { useWorkPromptSubject } from "../prompts/useWorkPromptSubject.ts";
import { releaseRowMenu } from "../releaseRowMenu.ts";
import { useReleaseCascadeToast } from "../releases/useReleaseCascadeToast.ts";
import EpicCreateSheet from "./EpicCreateSheet.tsx";
import {
  STATUS_ICONS,
  STATUS_LABEL_KEYS,
  STATUS_ORDER,
  STATUS_TONE,
  isDeletable,
  openQuestsOf,
} from "./epicStatus.ts";
import ProjectEpicsProgress from "./ProjectEpicsProgress.tsx";
import { useConfirmEpicDelete } from "./useConfirmEpicDelete.ts";

/**
 * The Epics list, built on {@link DataTable}.
 *
 * `getEpics` returns the project's whole list in one response — an epic is
 * a bounded initiative, so a project has tens of them, not thousands — so
 * search, status filter, sort and paging are all applied client-side here
 * rather than round-tripping. Same shape as `ProjectErrors`, and the
 * reason neither needed a paginated endpoint.
 *
 * Status is a read-only CHIP here, but the row menu carries the one
 * lifecycle decision a person makes: **Mark as ready** on a `draft` epic,
 * **Back to draft** on a `ready` one (#Q2223). The other two statuses
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
  const dialog = useDialog();
  const optimistic = useOptimisticWrite();
  const confirmDelete = useConfirmEpicDelete();
  const queries = useQueryClient();
  const router = useRouter();
  const epicApi = useClient<EpicController>();
  const [project] = useStore(currentProjectAtom);
  const [releases] = useStore(currentReleasesAtom);
  const reportBulk = useBulkReport();
  const agentPrompt = useAgentPrompt();
  const promptSubject = useWorkPromptSubject();
  const alepha = useAlepha();
  // The write below moves the epic's quests too (#Q2111), and a row the
  // reader did not name must not move without a word.
  const reportCascade = useReleaseCascadeToast();

  /**
   * The status filter the table last fetched with (#Q3673). A shelve takes
   * the row off the page at once when that filter leaves shelved epics out,
   * rather than patching its chip and waiting for the refetch.
   */
  const statusFilter = useRef<EpicResource["status"][]>([]);
  const hidesShelved = () =>
    statusFilter.current.length > 0 &&
    !statusFilter.current.includes("shelved");

  const [createOpen, setCreateOpen] = useState(false);
  // The preset rail's badges (#Q3780), counted by `fetchEpics` from the
  // project's whole list, which it already holds: no request of their own.
  const [presetCounts, setPresetCounts] = useState<EpicPresetCounts>();
  // Bumped after a create, which happens outside the table and so has no
  // `ctx.refresh()` of its own to call.
  const [reload, setReload] = useState(0);

  // One `useAction` per write (#E59, #Q2326). A refusal is the server's
  // sentence, toasted by the root `ActionErrorToaster`, and every follow-up
  // (the refresh, the cascade report) runs inside the handler, so none
  // follows a failure.

  /**
   * The same write `EpicReleaseControl` makes on the epic's own page, from
   * the row menu instead. `null` detaches; an absent key would leave the
   * attachment alone, which is why the caller passes one or the other and
   * never `undefined`.
   */
  const setReleaseAction = useAction<
    [epic: EpicResource, releaseId: number | null, refresh: () => void],
    void
  >(
    {
      handler: async (_ctx, epic, releaseId, refresh) => {
        const updated = await epicApi.updateEpic({
          params: { id: epic.id },
          body: { releaseId },
        });
        // The Release column is drawn from the row, so it repaints only once
        // the fetch comes back with the new value.
        refresh();
        reportCascade(updated.releaseCascade);
      },
    },
    [epicApi, reportCascade],
  );

  const ref = (epic: EpicResource) => `#E${epic.number}`;

  /**
   * The lifecycle writes below are optimistic. The row changes in the
   * click's own frame and the request leaves at once; a refusal puts the row
   * back. They are plain functions, not `useAction`s, for the frame:
   * `useAction` awaits its begin listeners before the handler runs.
   *
   * Only delete keeps a confirm (it takes the epic's quests with it, and is
   * the one verb with no way back on the server). There is no Undo.
   */
  const setStatus = (
    epic: EpicResource,
    status: "draft" | "ready",
    ctx: RowActionContext<EpicResource>,
  ) =>
    void optimistic.run({
      message: tr(status === "ready" ? "epic.done.ready" : "epic.done.draft", {
        args: [ref(epic)],
      }),
      apply: () => ctx.optimistic.patch(epic, { ...epic, status }),
      commit: () =>
        epicApi.setEpicStatus({ params: { id: epic.id }, body: { status } }),
    });

  // The quests moved too: the quest list, the board and the agent prompt
  // gate read these keys.
  const invalidateWork = () => {
    queries.invalidate(["quests", project?.id]);
    queries.invalidate(["epics", project?.id]);
  };

  /**
   * Shelving hands every open quest back to `todo` with no assignee, and
   * unshelving does not give them back; the toast counts those quests.
   */
  const shelve = (epic: EpicResource, ctx: RowActionContext<EpicResource>) => {
    const open = openQuestsOf(epic);
    void optimistic.run({
      message: tr("epic.done.shelved", { args: [ref(epic)] }),
      description:
        open > 0
          ? tr("epic.done.shelvedQuests", { args: [String(open)] })
          : undefined,
      apply: () =>
        hidesShelved()
          ? ctx.optimistic.remove(epic)
          : ctx.optimistic.patch(epic, { ...epic, status: "shelved" }),
      commit: () => epicApi.shelveEpic({ params: { id: epic.id } }),
      onCommitted: invalidateWork,
    });
  };

  /**
   * Unshelve: the quests it brings back come back unassigned, as the shelve
   * left them.
   */
  const unshelve = (epic: EpicResource, ctx: RowActionContext<EpicResource>) =>
    void optimistic.run({
      message: tr("epic.done.unshelved", { args: [ref(epic)] }),
      apply: () =>
        ctx.optimistic.patch(epic, {
          ...epic,
          // The server's own rule: back to in progress if it ever started.
          status: epic.startedAt ? "in_progress" : "draft",
        }),
      commit: () => epicApi.unshelveEpic({ params: { id: epic.id } }),
      onCommitted: invalidateWork,
    });

  const remove = async (
    epic: EpicResource,
    ctx: RowActionContext<EpicResource>,
  ) => {
    // The confirm the epic page's menu asks too, then the delete is sent.
    if (!(await confirmDelete(epic))) return;
    void optimistic.run({
      message: tr("epic.done.deleted", { args: [ref(epic)] }),
      intent: "primary",
      apply: () => ctx.optimistic.remove(epic),
      commit: () => epicApi.deleteEpic({ params: { id: epic.id } }),
      onCommitted: invalidateWork,
    });
  };

  // The three bulk writes never reject: `settleBulk` sorts every refusal into
  // the report `useBulkReport` shows. They are actions for the busy state and
  // the dropped double click, not for the toaster.
  const bulkReleaseAction = useAction<
    [
      release: ReleaseResource,
      selected: EpicResource[],
      ctx: BulkActionContext,
    ],
    void
  >(
    {
      handler: async (_ctx, release, selected, ctx) => {
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
          tr("board.bulk.released", {
            args: [String(outcome.done.length), release.tag ?? release.title],
          }),
        );
        ctx.refresh();
        ctx.clearSelection();
      },
    },
    [epicApi, reportBulk, tr],
  );

  const bulkReady = (
    selected: EpicResource[],
    ctx: BulkActionContext<EpicResource>,
  ) => {
    const ids = selected.map((epic) => epic.id);
    ctx.clearSelection();
    // One patch per row: each chip turns in place, rather than the rows
    // leaving a list that still shows them.
    const handles = selected.map((epic) =>
      ctx.optimistic.patch(epic, { ...epic, status: "ready" }),
    );
    void optimistic.run({
      message: tr("epic.done.bulkReady", { args: [String(ids.length)] }),
      apply: () => ({
        rollback: () => handles.forEach((h) => h.rollback()),
        settle: () => handles.forEach((h) => h.settle()),
      }),
      commit: async () => {
        const outcome = await settleBulk(ids, (id) =>
          epicApi.setEpicStatus({ params: { id }, body: { status: "ready" } }),
        );
        // A refused row comes back on its own with the settle's reload.
        if (outcome.failed.length > 0) reportBulk(outcome, "");
      },
    });
  };

  const bulkDelete = async (
    selected: EpicResource[],
    ctx: BulkActionContext<EpicResource>,
  ) => {
    // Only a draft, ready or shelved epic with nothing completed is deleted
    // (#Q2666, #Q3950): the rest are left
    // out of the count and named, rather than sent to be refused one by
    // one. The plural of the row menu's own warning, and it says the
    // same true thing: the quests go with the epics, the folios stay.
    const deletable = selected.filter(isDeletable);
    const skipped = selected.filter((epic) => !isDeletable(epic));
    const n = String(deletable.length);
    const quests = deletable.reduce(
      (sum, epic) => sum + epic.progress.total,
      0,
    );
    const description = [
      tr("epic.bulk.delete.description", { args: [String(quests)] }),
      ...(skipped.length > 0
        ? [
            tr("epic.bulk.delete.skipped", {
              args: [
                skipped
                  .map((epic) => `#E${epic.number} ${epic.title}`)
                  .join(", "),
              ],
            }),
          ]
        : []),
    ].join(" ");
    const confirmed = await dialog.confirm({
      title: tr("epic.bulk.delete.title", { args: [n] }),
      description,
      confirmLabel: tr("epic.bulk.delete.confirm", { args: [n] }),
      cancelLabel: tr("common.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    ctx.clearSelection();
    void optimistic.run({
      message: tr("epic.done.bulkDeleted", { args: [n] }),
      intent: "primary",
      apply: () => ctx.optimistic.remove(deletable),
      commit: async () => {
        const outcome = await settleBulk(
          deletable.map((epic) => epic.id),
          (id) => epicApi.deleteEpic({ params: { id } }),
        );
        if (outcome.failed.length > 0) reportBulk(outcome, "");
      },
      onCommitted: invalidateWork,
    });
  };

  /**
   * Shelve every selected epic that can be (#Q3561), as the row menu does
   * one at a time.
   *
   * Confirmed first, because it reaches past the epics: their open quests
   * are unassigned and shelved with them. The confirm counts those quests
   * and names the epics left out (completed or shelved already), which are
   * never sent.
   */
  const bulkShelve = async (
    selected: EpicResource[],
    ctx: BulkActionContext<EpicResource>,
  ) => {
    const shelvable = selected.filter(isShelvable);
    const skipped = selected.filter((epic) => !isShelvable(epic));
    const n = String(shelvable.length);
    const quests = shelvable.reduce((sum, epic) => sum + openQuestsOf(epic), 0);
    const description = [
      tr("epic.bulk.shelve.description", { args: [String(quests)] }),
      ...(skipped.length > 0
        ? [
            tr("epic.bulk.shelve.skipped", {
              args: [
                skipped
                  .map((epic) => `#E${epic.number} ${epic.title}`)
                  .join(", "),
              ],
            }),
          ]
        : []),
    ].join(" ");
    const confirmed = await dialog.confirm({
      title: tr("epic.bulk.shelve.title", { args: [n] }),
      description,
      confirmLabel: tr("epic.bulk.shelve.confirm", { args: [n] }),
      cancelLabel: tr("common.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    ctx.clearSelection();
    const handles = hidesShelved()
      ? [ctx.optimistic.remove(shelvable)]
      : shelvable.map((epic) =>
          ctx.optimistic.patch(epic, { ...epic, status: "shelved" }),
        );
    void optimistic.run({
      message: tr("epic.done.bulkShelved", { args: [n] }),
      apply: () => ({
        rollback: () => handles.forEach((h) => h.rollback()),
        settle: () => handles.forEach((h) => h.settle()),
      }),
      commit: async () => {
        const outcome = await settleBulk(
          shelvable.map((epic) => epic.id),
          (id) => epicApi.shelveEpic({ params: { id } }),
        );
        if (outcome.failed.length > 0) reportBulk(outcome, "");
      },
      onCommitted: invalidateWork,
    });
  };

  /**
   * Unshelve every selected shelved epic, as the row's unshelve does: the
   * quests come back unassigned.
   */
  const bulkUnshelve = (
    selected: EpicResource[],
    ctx: BulkActionContext<EpicResource>,
  ) => {
    const shelved = selected.filter((epic) => epic.status === "shelved");
    const skipped = selected.length - shelved.length;
    ctx.clearSelection();
    const handles = shelved.map((epic) =>
      ctx.optimistic.patch(epic, {
        ...epic,
        // The server's own rule: back to in progress if it ever started.
        status: epic.startedAt ? "in_progress" : "draft",
      }),
    );
    void optimistic.run({
      message: tr("epic.done.bulkUnshelved", {
        args: [String(shelved.length)],
      }),
      description:
        skipped > 0
          ? tr("epic.bulk.unshelve.skipped", { args: [String(skipped)] })
          : undefined,
      apply: () => ({
        rollback: () => handles.forEach((h) => h.rollback()),
        settle: () => handles.forEach((h) => h.settle()),
      }),
      commit: async () => {
        const outcome = await settleBulk(
          shelved.map((epic) => epic.id),
          (id) => epicApi.unshelveEpic({ params: { id } }),
        );
        if (outcome.failed.length > 0) reportBulk(outcome, "");
      },
      onCommitted: invalidateWork,
    });
  };

  // Page-wide: every row and bulk write waits while any of them runs. The
  // bulk bar has no disabled state, so its buttons are hidden for that time.
  const busy = setReleaseAction.loading || bulkReleaseAction.loading;

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
    filters?: DataTableFilterValues<typeof filterFields>;
  }): Promise<Page<EpicResource>> => {
    const needle = (filters?.search ?? "").trim().toLowerCase();
    // A row shows one truncated line of the description, so the list asks for
    // that line (`brief`), and for the whole text only while a search looks
    // inside it: the full list of a large project was 1 MB, 94% of it
    // descriptions (#Q3713).
    const all = await epicApi.getEpics({
      params: { projectId: project.id },
      query: { brief: !needle },
    });

    // Push the freshest draft count to the sidebar badge, the same way
    // `ProjectErrors` pushes `openCount`. Free: `getEpics` already returns
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
      count: all.filter((epic) => epic.status === "draft").length,
    });
    const picked = filters?.release ?? [];
    // The selections OR together, and the sentinel is one of them: an epic
    // matches if it is attached to a picked release, or if "No release" is
    // picked and it is attached to nothing.
    const wantsUnattached = picked.includes(QUEST_RELEASE_NONE);
    const wantedIds = new Set(
      picked.filter((v) => v !== QUEST_RELEASE_NONE).map(Number),
    );
    // What a preset keeps (`keepOnPreset`, #Q3854): the release and the
    // search. The badges count over this list, so "Ready 13" never sits
    // beside the three ready epics of the release picked.
    const kept = all.filter((epic) => {
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
    });

    // Set only when a count moved, so a refetch that changes nothing does
    // not re-render the table it is running in.
    const counts = epicPresetCounts(kept);
    setPresetCounts((previous) =>
      previous && JSON.stringify(previous) === JSON.stringify(counts)
        ? previous
        : counts,
    );

    const statuses = filters?.status ?? [];
    statusFilter.current = statuses;
    const openReviews = filters?.reviews === "open";
    const rows = sortEpics(
      kept.filter((epic) => {
        if (statuses.length > 0 && !statuses.includes(epic.status)) {
          return false;
        }
        if (openReviews && (epic.openQuestions ?? 0) === 0) return false;
        return true;
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
  // checkbox column exists because this array is not empty - `DataTable`
  // derives `hasCheckbox` from it - so gating an entry out on permissions
  // can leave the selection with nothing to do, which is why both are
  // pushed conditionally rather than rendered disabled.
  //
  // Bulk Mark as ready exists for an ALL-DRAFT selection only (feedback
  // #P2198, #Q2339). It was refused with #Q2223 for two reasons, and each is
  // now answered rather than ignored, so do not "restore" the old rule:
  //
  // - a selection mixing draft, ready and started epics would have to refuse
  //   most of what it held: the entry is `visible` only when every selected
  //   epic is a draft, so it is hidden, never offered and then refused;
  // - deciding that a spec is done is a per-epic decision: the one
  //   confirmation names how many epics become ready, and which ones when
  //   the list is short enough to read.
  //
  // Back to draft for an all-ready selection was not asked for.
  //
  // Every entry refreshes and then clears, in that order: a selection that
  // survives a delete points at rows that no longer exist. `ctx.refresh()`
  // is also what repaints the sidebar's draft-epic badge, since
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
      label: tr("board.filter.noRelease"),
    },
    ...(releases ?? []).map((release) => ({
      value: String(release.id),
      label: release.tag ?? release.title,
    })),
  ];

  /**
   * The list's filters: a search over title, description and number, a status
   * multi-select whose empty selection means "all", and a release filter.
   *
   * The status is an array, like the Quests list's, because the everyday view
   * is several statuses at once (everything not yet completed, say) and a
   * single value could not say it (feedback #2069). It is the column's own
   * enum rather than a list restated here, so a status renamed on the entity
   * cannot survive in a filter that no longer matches anything.
   */
  const filterFields = {
    // A preset leaves the search and the release as they are (#Q3854), so
    // "what is ready in 1.2.0" is browsed preset by preset.
    search: { preset: "search", keepOnPreset: true },
    status: {
      schema: z.array(epicResourceSchema.shape.status),
      label: tr("epic.filter.status"),
      icon: CircleDot,
      optionLabel: (status: EpicResource["status"]) =>
        tr(STATUS_LABEL_KEYS[status]),
      control: {
        clearLabel: tr("epic.filter.allStatuses"),
      },
    },
    /**
     * Release ids as strings, plus the `QUEST_RELEASE_NONE` sentinel, exactly
     * like the Quests table's (feedback #2102).
     *
     * ⚠️ Strings rather than numbers even though a release id is an integer:
     * the sentinel shares the list, which is what lets "unassigned, or 0.29.0"
     * be one selection. Two fields would AND where a multi-select ORs.
     *
     * Unlike the Quests table's, this one never leaves the browser:
     * `getEpics` answers with the project's whole list, so the predicate sits
     * beside `search` and `status` in `fetchEpics`.
     *
     * Hidden until the project has a release, the way the Quests table hides
     * it: with none, the only option would be the sentinel, and a filter
     * offering one value that matches everything is a control with nothing
     * to do.
     */
    release: {
      schema: z.array(z.string()),
      label: tr("board.filter.release"),
      icon: Flag,
      items: releaseOptions,
      hidden: (releases ?? []).length === 0,
      keepOnPreset: true,
      control: {
        clearLabel: tr("board.filter.allReleases"),
      },
    },
    /**
     * Epics with a review question nobody answered yet: what the Open
     * reviews preset sets (#Q3780). One value, since "answered" is not a
     * question anybody asks of this list.
     */
    reviews: {
      schema: z.enum(["open"]),
      label: tr("epic.filter.reviews"),
      icon: MessageCircleQuestion,
      optionLabel: () => tr("epic.filter.reviews.open"),
    },
  } satisfies DataTableFilterFields;

  // The preset rail beside the table, the quests list's own component
  // (`filters.presets`, #Q3780): a set of this table's filters each, built on
  // the epic lifecycle, with a badge counted from the list `fetchEpics` read.
  const presetItems = EPIC_PRESETS.map((preset) => ({
    key: preset.key,
    label: tr(`epic.presets.${preset.key}`),
    hint: tr(`epic.presets.${preset.key}.hint`),
    icon: preset.icon,
    group: preset.group,
    tone: preset.tone,
    count: preset.quiet ? undefined : presetCounts?.[preset.key],
    values: preset.values,
  }));

  const bulkActions: Array<
    BulkAction<EpicResource> | BulkMenuAction<EpicResource>
  > = [];

  if (epicApi.updateEpic.can()) {
    bulkActions.push({
      icon: Flag,
      label: tr("board.bulk.release"),
      visible: () => !busy,
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
            onClick: (selected, ctx) =>
              void bulkReleaseAction.run(release, selected, ctx),
          })),
    });
  }

  if (epicApi.setEpicStatus.can()) {
    bulkActions.push({
      icon: Play,
      label: tr("epic.status.actions.markReady"),
      visible: (selected) =>
        !busy &&
        selected.length > 0 &&
        selected.every((epic) => epic.status === "draft"),
      onClick: (selected, ctx) => bulkReady(selected, ctx),
    });
  }

  // Shelve when the selection holds an epic that can be shelved, Unshelve
  // when it holds a shelved one; a mixed selection gets both (#Q3561).
  if (epicApi.shelveEpic.can()) {
    bulkActions.push({
      icon: Archive,
      label: tr("epic.status.actions.shelve"),
      visible: (selected) => !busy && selected.some(isShelvable),
      onClick: (selected, ctx) => void bulkShelve(selected, ctx),
    });
  }

  if (epicApi.unshelveEpic.can()) {
    bulkActions.push({
      icon: ArchiveRestore,
      label: tr("epic.status.actions.unshelve"),
      visible: (selected) =>
        !busy && selected.some((epic) => epic.status === "shelved"),
      onClick: (selected, ctx) => bulkUnshelve(selected, ctx),
    });
  }

  if (epicApi.deleteEpic.can()) {
    bulkActions.push({
      icon: Trash2,
      label: tr("board.bulk.delete"),
      destructive: true,
      visible: (selected) => !busy && selected.some(isDeletable),
      onClick: (selected, ctx) => void bulkDelete(selected, ctx),
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <DataTable<EpicResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey={`lor.epics.${project.id}`}
        // Back on the tab, the rows read again (#Q4069).
        refreshOnFocus
        bulkActions={bulkActions}
        defaultSort={{ field: "updatedAt", direction: "desc" }}
        emptyMessage={tr("epic.list.empty")}
        noMatchState={{ title: tr("epic.list.noMatch") }}
        refreshSignal={reload}
        filters={{
          fields: filterFields,
          // No preset by default: All, as before the rail (#Q3780). Active
          // as the default would hide every draft and ready epic on a first
          // visit, the drafts the sidebar's badge sends the reader to
          // included. A link's query (`?status=ready`) selects a preset, and
          // the reader's choice persists under `persistenceKey`, as on the
          // quests list.
          fromQuery: true,
          presets: {
            items: presetItems,
            all: {
              label: tr("epic.presets.all"),
              hint: tr("epic.presets.all.hint"),
            },
          },
        }}
        fetch={fetchEpics}
        onRowHover={(epic) => {
          if (epic) {
            router.prefetch("projectEpic", {
              params: {
                projectSlug: router.state.params.projectSlug,
                epicNumber: String(epic.number),
              },
            });
          }
        }}
        onRowClick={(epic) =>
          router.push("projectEpic", {
            params: {
              projectSlug: router.state.params.projectSlug,
              epicNumber: String(epic.number),
            },
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
                <div
                  className="flex items-baseline gap-2"
                  data-testid={`epic-title-line-${epic.number}`}
                >
                  {/* A real anchor inside a clickable row, so the browser owns
                      cmd / shift / middle click, shows the URL on hover and
                      offers "copy link address". `stopPropagation` because the
                      row carries `onRowClick` too: without it a plain click
                      navigates twice, once through each. No `hover:underline`
                      - the row already highlights under the pointer, and the
                      Quests table reads better for leaving the title still. */}
                  <Link
                    href={router.path("projectEpic", {
                      params: {
                        projectSlug: router.state.params.projectSlug,
                        epicNumber: String(epic.number),
                      },
                    })}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 truncate text-sm font-medium"
                    title={`${formatReference("epic", epic.number)} - ${epic.title}`}
                  >
                    {/* The number carries the title's own colour: it is part
                        of the name, not an annotation on it. Only the
                        separator is muted. */}
                    {formatReference("epic", epic.number)}{" "}
                    <span className="text-muted-foreground">-</span>{" "}
                    {epic.title}
                  </Link>
                  {/* The review questions still open (#E121), while the plan
                      is open: past ready they are a record, not a to-do. On
                      the title's line, so the row is no taller for them, and
                      `shrink-0` so the title truncates first (#Q3296). */}
                  {/* A blocker always wins the slot (#Q3634): red, ahead of
                      the amber questions, because it stops the plan. */}
                  {(epic.status === "draft" || epic.status === "ready") &&
                  (epic.openBlockers ?? 0) > 0 ? (
                    <span
                      className="text-danger-text ml-auto inline-flex shrink-0 items-center gap-1 text-xs"
                      data-testid={`epic-open-blockers-${epic.number}`}
                    >
                      <OctagonAlert aria-hidden="true" className="size-3" />
                      {tr("epic.list.openBlockers", {
                        args: [String(epic.openBlockers)],
                      })}
                    </span>
                  ) : (epic.status === "draft" || epic.status === "ready") &&
                    (epic.openQuestions ?? 0) > 0 ? (
                    <span
                      className="text-warning-text ml-auto inline-flex shrink-0 items-center gap-1 text-xs"
                      data-testid={`epic-open-questions-${epic.number}`}
                    >
                      {/* Sized to the line (`size-3` on `text-xs`), so the
                          row keeps its height (#Q3532). */}
                      <TriangleAlert aria-hidden="true" className="size-3" />
                      {tr("epic.list.openQuestions", {
                        args: [String(epic.openQuestions)],
                      })}
                    </span>
                  ) : null}
                </div>
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
          // The predecessor that gates this epic's start (#P2), as a chip in
          // the predecessor's own status tone, so a glance tells "still
          // blocked" from "free to start". Hidden by default: most epics
          // have no predecessor, and the column would sit empty on most rows.
          dependsOnNumber: {
            label: tr("epic.list.column.dependsOn"),
            sortable: true,
            defaultHidden: true,
            className: "w-32",
            cell: (epic) => {
              if (
                epic.dependsOnNumber === undefined ||
                epic.dependsOnStatus === undefined
              ) {
                return null;
              }
              const Icon = STATUS_ICONS[epic.dependsOnStatus];
              return (
                <Link
                  href={router.path("projectEpic", {
                    params: {
                      projectSlug: router.state.params.projectSlug,
                      epicNumber: String(epic.dependsOnNumber),
                    },
                  })}
                  onClick={(e) => e.stopPropagation()}
                  title={tr(STATUS_LABEL_KEYS[epic.dependsOnStatus])}
                >
                  <Badge
                    variant="tint"
                    tone={STATUS_TONE[epic.dependsOnStatus]}
                    className="font-mono"
                  >
                    <Icon className="size-3" />
                    {formatReference("epic", epic.dependsOnNumber)}
                  </Badge>
                </Link>
              );
            },
          },
          // Whether the epic was reviewed, and how many times (#Q3311). The
          // open questions count beside the title is silent both for an epic
          // never reviewed and for one whose questions are all answered; this
          // column tells them apart. Shown by default (#Q3782): whether an
          // epic was reviewed is read at a glance; a reader who hid it keeps
          // that choice.
          reviewCount: {
            label: tr("epic.list.column.reviews"),
            sortable: true,
            className: "w-24",
            cell: (epic) =>
              (epic.reviewCount ?? 0) > 0 ? (
                <span
                  className="tabular-nums"
                  data-testid={`epic-review-count-${epic.number}`}
                >
                  {epic.reviewCount}
                </span>
              ) : (
                <span
                  className="text-muted-foreground"
                  title={tr("epic.list.neverReviewed")}
                  data-testid={`epic-review-count-${epic.number}`}
                >
                  -
                </span>
              ),
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
          // Review is offered while the plan is still open (draft or
          // ready): once the epic is in progress its quest set is what is
          // being worked, not what is being written. Work on it is offered
          // on a ready epic, whose first accepted quest starts it, and on
          // one in progress, because a half-worked epic can be handed over.
          //
          // On a draft one too, but only to a reader who may mark it ready,
          // and the click does both: it copies the prompt, then makes the
          // same optimistic write as the row's Mark as ready
          // (feedback #P2226, #Q3228). A draft epic's quests refuse to be
          // accepted, so the prompt would be useless without it, and whether
          // the spec is done stays the owner's call: it is the owner's click.
          // A completed epic gets neither, so the group has no children and
          // `DataTable` renders nothing for it.
          ...(agentPrompt.enabled
            ? [
                {
                  icon: Bot,
                  label: tr("agentPrompts.menu"),
                  children: [
                    ...(epic.status === "draft" || epic.status === "ready"
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
                    ...(epic.status === "ready" ||
                    epic.status === "in_progress" ||
                    (epic.status === "draft" && epicApi.setEpicStatus.can())
                      ? [
                          {
                            // The verb and glyph quests and feedback use for
                            // the same hand-over, as the detail page's menu
                            // does through AGENT_PROMPT_MENU_META (#P2182).
                            icon: Wrench,
                            label: tr("agentPrompts.workOnIt"),
                            onClick: (
                              row: EpicResource,
                              ctx: RowActionContext<EpicResource>,
                            ) => {
                              // The copy inside a click: Safari's clipboard
                              // activation does not survive an await.
                              const copy = () =>
                                void agentPrompt.copy(
                                  "epicActivate",
                                  promptSubject.forEpic(row),
                                );
                              if (row.status !== "draft") {
                                copy();
                                return;
                              }
                              // A draft epic becomes ready with it: asked
                              // first (#Q3583), and the copy runs in the
                              // confirm button's own click.
                              void dialog.confirm({
                                title: tr("epic.workOnIt.confirm.title"),
                                description: tr(
                                  "epic.workOnIt.confirm.description",
                                  {
                                    args: [row.title],
                                  },
                                ),
                                confirmLabel: tr(
                                  "epic.workOnIt.confirm.action",
                                ),
                                cancelLabel: tr("common.cancel"),
                                onConfirm: () => {
                                  copy();
                                  setStatus(row, "ready", ctx);
                                },
                              });
                            },
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
                          busy ||
                          releaseRowMenu(releases, epic.releaseId).locked,
                        onClick: (
                          row: EpicResource,
                          { refresh }: { refresh: () => void },
                        ) =>
                          void setReleaseAction.run(row, release.id, refresh),
                      }),
                    ),
                    {
                      icon: FlagOff,
                      label: tr("epic.aside.release.none"),
                      checked: (row: EpicResource) => row.releaseId == null,
                      disabled: () =>
                        busy || releaseRowMenu(releases, epic.releaseId).locked,
                      onClick: (
                        row: EpicResource,
                        { refresh }: { refresh: () => void },
                      ) => void setReleaseAction.run(row, null, refresh),
                    },
                  ],
                },
              ]
            : []),
          // The one lifecycle decision, gated on the row's own status: a
          // draft epic can be marked ready, a ready one sent back to
          // draft, and an epic that has started offers nothing, because
          // its other two moves happen on their own (#Q2223).
          ...(epic.status === "draft" && epicApi.setEpicStatus.can()
            ? [
                {
                  icon: Play,
                  label: tr("epic.status.actions.markReady"),
                  disabled: () => busy,
                  onClick: (
                    row: EpicResource,
                    ctx: RowActionContext<EpicResource>,
                  ) => setStatus(row, "ready", ctx),
                },
              ]
            : []),
          ...(epic.status === "ready" && epicApi.setEpicStatus.can()
            ? [
                {
                  icon: Undo2,
                  label: tr("epic.status.actions.backToDraft"),
                  disabled: () => busy,
                  onClick: (
                    row: EpicResource,
                    ctx: RowActionContext<EpicResource>,
                  ) => setStatus(row, "draft", ctx),
                },
              ]
            : []),
          // Shelve sets the whole plan aside, from any status but
          // completed; Unshelve brings it back (#E78).
          ...(epic.status !== "completed" &&
          epic.status !== "shelved" &&
          epicApi.shelveEpic.can()
            ? [
                {
                  icon: Archive,
                  label: tr("epic.status.actions.shelve"),
                  disabled: () => busy,
                  onClick: (
                    row: EpicResource,
                    ctx: RowActionContext<EpicResource>,
                  ) => shelve(row, ctx),
                },
              ]
            : []),
          ...(epic.status === "shelved" && epicApi.unshelveEpic.can()
            ? [
                {
                  icon: ArchiveRestore,
                  label: tr("epic.status.actions.unshelve"),
                  disabled: () => busy,
                  onClick: (
                    row: EpicResource,
                    ctx: RowActionContext<EpicResource>,
                  ) => unshelve(row, ctx),
                },
              ]
            : []),
          // Only while the plan is open (#Q2666): deleting an epic deletes
          // its quests, so a started or finished one offers Shelve above
          // instead of a Delete the server would refuse.
          ...(isDeletable(epic)
            ? [
                {
                  icon: Trash2,
                  label: tr("epic.action.delete"),
                  destructive: true,
                  disabled: () => busy,
                  onClick: (
                    row: EpicResource,
                    ctx: RowActionContext<EpicResource>,
                  ) => void remove(row, ctx),
                },
              ]
            : []),
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
 * Client-side sort over the full epic list. Supports the six sortable
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
    if (field === "dependsOnNumber") {
      // Epics with no predecessor sort LAST in both directions, for the
      // reason the release sort above gives.
      const depA = a.dependsOnNumber;
      const depB = b.dependsOnNumber;
      if (depA === undefined || depB === undefined) {
        if (depA === undefined && depB === undefined) {
          return a.number - b.number;
        }
        return depA !== undefined ? -1 : 1;
      }
      return (depA - depB) * dir || a.number - b.number;
    }
    if (field === "reviewCount") {
      // Never reviewed counts as zero, so it leads ascending and trails
      // descending: "which epics still need a review" is the ascending read.
      return (
        ((a.reviewCount ?? 0) - (b.reviewCount ?? 0)) * dir ||
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

/**
 * Whether the server will shelve this epic: any status but `completed`,
 * the server's own rule (`EpicWorkflowService.assertShelvable`, #E78), and
 * not one already shelved, which would have nothing to do.
 */
const isShelvable = (epic: Pick<EpicResource, "status">): boolean =>
  epic.status !== "completed" && epic.status !== "shelved";

type EpicPresetKey =
  | "open"
  | "active"
  | "ready"
  | "drafts"
  | "done"
  | "shelved"
  | "reviews";

type EpicPresetCounts = Record<EpicPresetKey, number>;

/**
 * The presets the epics rail offers, in its order (#Q3780): every open epic,
 * then the epic lifecycle, then what asks the owner something, divided by a rule.
 */
const EPIC_PRESETS: Array<{
  key: EpicPresetKey;
  icon: LucideIcon;
  group: "primary" | "secondary";
  tone?: "danger";
  /**
   * No badge: a number of finished or set-aside epics asks nothing of the
   * reader.
   */
  quiet?: boolean;
  values: {
    status?: EpicResource["status"][];
    reviews?: "open";
  };
}> = [
  // Every epic not yet finished (#Q3885): what was built by hand by ticking
  // Draft, Ready and In progress in the Status filter.
  {
    key: "open",
    icon: CircleDot,
    group: "primary",
    values: { status: ["draft", "ready", "in_progress"] },
  },
  {
    key: "active",
    icon: Play,
    group: "primary",
    values: { status: ["in_progress"] },
  },
  {
    key: "ready",
    icon: ClipboardCheck,
    group: "primary",
    values: { status: ["ready"] },
  },
  {
    key: "drafts",
    icon: NotebookPen,
    group: "primary",
    values: { status: ["draft"] },
  },
  {
    key: "done",
    icon: CircleCheck,
    group: "primary",
    quiet: true,
    values: { status: ["completed"] },
  },
  {
    key: "shelved",
    icon: Archive,
    group: "primary",
    quiet: true,
    values: { status: ["shelved"] },
  },
  {
    key: "reviews",
    icon: MessageCircleQuestion,
    group: "secondary",
    tone: "danger",
    values: { reviews: "open" },
  },
];

/**
 * Each preset's count over the epics the kept filters (release, search)
 * leave, the list a preset click would narrow.
 */
const epicPresetCounts = (epics: EpicResource[]): EpicPresetCounts => ({
  open: epics.filter((epic) =>
    (["draft", "ready", "in_progress"] as const).some(
      (status) => status === epic.status,
    ),
  ).length,
  active: epics.filter((epic) => epic.status === "in_progress").length,
  ready: epics.filter((epic) => epic.status === "ready").length,
  drafts: epics.filter((epic) => epic.status === "draft").length,
  done: epics.filter((epic) => epic.status === "completed").length,
  shelved: epics.filter((epic) => epic.status === "shelved").length,
  reviews: epics.filter((epic) => (epic.openQuestions ?? 0) > 0).length,
});
