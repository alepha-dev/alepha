import {
  TimeAgo,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useDialog,
  useToast,
} from "@alepha/ui";
import {
  type BulkActionContext,
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import { type Page, z } from "alepha";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  AppWindow,
  CheckCircle2,
  CircleDot,
  FileText,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { BlightController } from "@/api/controllers/BlightController.ts";
import { QUEST_STATUS_PREFIX } from "@/api/entities/blights.ts";
import type { BlightResource } from "@/api/schemas/blightResourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentBlightCountAtom } from "../../../atoms/currentBlightCountAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { hasCapability } from "../../../services/projectCapabilities.ts";
import { formatReference } from "../../shared/element/typedReference.ts";
import { AgentPromptsMenu } from "../prompts/AgentPromptsMenu.tsx";
import { useAgentPromptSubject } from "../prompts/useAgentPromptSubject.ts";
import BlightSourceCell from "./BlightSourceCell.tsx";
import { sigilNameParts } from "./sigilNameParts.ts";

/**
 * Owner-facing Blights inbox, built on {@link DataTable}.
 *
 * The `listBlights` endpoint returns the full deduplicated list (crashes are
 * folded by root cause, so the row count stays small), so sort + paging are
 * applied client-side here rather than round-tripping the server.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are 100%
 * attacker-controlled. They are rendered ONLY via plain React text
 * interpolation (`{value}`) — React escapes it. NEVER MarkdownView /
 * dangerouslySetInnerHTML. See folio #12.
 */
const ProjectBlights = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const promptSubject = useAgentPromptSubject();
  // Blights live under Apps: there is no capability of their own, and this
  // page's route is already gated on it. Stated anyway rather than passing
  // the item unconditionally, so the menu carries its own gate wherever this
  // component ends up rendered.
  const appsEnabled = hasCapability(project, "apps");
  const alepha = useAlepha();
  const blightApi = useClient<BlightController>();
  const canTriage = blightApi.resolveBlight.can();
  const toaster = useToast();
  const dialog = useDialog();

  const [stackView, setStackView] = useState<BlightResource | null>(null);
  // Sigil options for the "filter by sigil" dropdown, hydrated from the list
  // response rather than from `SigilController.listSigils`: the filter needs
  // id + label, and that endpoint hands back the whole credential row
  // (token prefix, kinds, creator) for a dropdown. One request, one shape,
  // nothing extra on the wire.
  const [sigilOptions, setSigilOptions] = useState<
    { id: string; label: string }[]
  >([]);

  // One `useAction` per triage verb (#E59, #Q2329). A refusal is the server's
  // sentence, toasted by the root `ActionErrorToaster`; follow-ups (the
  // refresh, the navigation) run inside the handler, so none follows a
  // failure.
  const deleteManyAction = useAction<
    [selected: BlightResource[], ctx: BulkActionContext],
    void
  >(
    {
      handler: async (selected, ctx) => {
        if (!project || selected.length === 0) return;
        const ok = await dialog.confirm({
          title: tr("blights.deleteSelectedConfirm", {
            args: [String(selected.length)],
          }),
          confirmLabel: tr("blights.action.delete"),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return;
        const res = await blightApi.deleteBlights({
          params: { projectId: project.id },
          body: { ids: selected.map((b) => b.id) },
        });
        toaster.success(
          tr("blights.toast.deletedMany", {
            args: [String(res.deleted)],
          }),
        );
        ctx.clearSelection();
        ctx.refresh();
      },
    },
    [blightApi, project, dialog, toaster, tr],
  );

  const resolveAction = useAction<
    [blight: BlightResource, refresh: () => void],
    void
  >(
    {
      handler: async (blight, refresh) => {
        if (!project) return;
        await blightApi.resolveBlight({
          params: { projectId: project.id, blightId: blight.id },
        });
        toaster.success(tr("blights.toast.resolved"));
        refresh();
      },
    },
    [blightApi, project, toaster, tr],
  );

  const forwardAction = useAction<
    [blight: BlightResource, refresh: () => void],
    void
  >(
    {
      handler: async (blight, refresh) => {
        if (!project) return;
        const res = await blightApi.forwardBlightToQuest({
          params: { projectId: project.id, blightId: blight.id },
        });
        toaster.success(
          tr("blights.toast.forwarded", {
            args: [formatReference("quest", res.questShortId)],
          }),
        );
        refresh();
        void router.push("projectQuest", {
          params: {
            projectSlug: project.slug,
            shortId: String(res.questShortId),
          },
        });
      },
    },
    [blightApi, project, router, toaster, tr],
  );

  const deleteAction = useAction<
    [blight: BlightResource, refresh: () => void],
    void
  >(
    {
      handler: async (blight, refresh) => {
        if (!project) return;
        const ok = await dialog.confirm({
          title: tr("blights.deleteConfirm"),
          confirmLabel: tr("blights.action.delete"),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return;
        await blightApi.deleteBlight({
          params: { projectId: project.id, blightId: blight.id },
        });
        toaster.success(tr("blights.toast.deleted"));
        refresh();
      },
    },
    [blightApi, project, dialog, toaster, tr],
  );

  // Page-wide: every triage control waits while any verb runs, since `run()`
  // drops a call made while its own is in flight.
  const busy =
    deleteManyAction.loading ||
    resolveAction.loading ||
    forwardAction.loading ||
    deleteAction.loading;

  const renderStatus = (status: string) => {
    if (status === "resolved") {
      return <Badge variant="secondary">{tr("blights.status.resolved")}</Badge>;
    }
    // The status carries the quest's database id after the prefix, not its
    // per-project number, so the badge says only that it was forwarded
    // (epic #32): a `#` before a database id read as a reference nobody had.
    if (status.startsWith(QUEST_STATUS_PREFIX)) {
      return <Badge variant="outline">{tr("blights.status.quest")}</Badge>;
    }
    return null;
  };

  /**
   * Both filters are applied client-side over the already-fetched list, and
   * both are optional: the inbox has no search box.
   */
  const filterFields = {
    /**
     * An ARRAY, and empty means every status (feedback #2092).
     *
     * ⚠️ `all` left the ENUM, not just the dropdown. It was a value standing
     * in for the absence of a filter, which the convention expresses as an
     * empty selection - and while it was a state, `fetchBlights` had to branch
     * on it as though a blight could BE "all".
     *
     * The default is still `["open"]` (`initialValues` below), so the inbox
     * opens on the triage queue rather than on its whole history, and the
     * filter holding that value keeps it on the bar.
     */
    status: {
      schema: z.array(z.enum(["open", "resolved"])),
      label: tr("blights.filter.status"),
      icon: CircleDot,
      items: [
        { label: tr("blights.filter.open"), value: "open" },
        { label: tr("blights.filter.resolved"), value: "resolved" },
      ],
      control: {
        clearLabel: tr("blights.filter.all"),
      },
    },
    /**
     * Absent means every app, the same way an empty `status` means every
     * status. It carried a literal `"all"` until feedback #2098: the select
     * drew it as a row of its own, so "All sigils" sat in the list looking
     * like an app you could pick. The options are filled by the fetcher, so
     * the filter is hidden until there are some.
     */
    sigilId: {
      schema: z.string(),
      label: tr("blights.filter.sigil"),
      icon: AppWindow,
      items: sigilOptions.map((s) => ({ label: s.label, value: s.id })),
      hidden: sigilOptions.length === 0,
      control: { clearLabel: tr("blights.filter.allApps") },
    },
  } satisfies DataTableFilterFields;

  // Fetch the full list, keep the sidebar badge in sync, then sort + slice
  // client-side into the `Page` shape DataTable consumes.
  const fetchBlights = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: DataTableFilterValues<typeof filterFields>;
  }): Promise<Page<BlightResource>> => {
    if (!project) {
      return emptyPage(page, size);
    }
    // Open-only (the default) hides resolved and forwarded rows server-side.
    // Anything else needs the full set, with `resolved` narrowed client-side:
    // an empty selection now means every status, which is the case the old
    // `"all"` value used to name.
    const statuses = filters?.status ?? [];
    const openOnly = statuses.length === 1 && statuses[0] === "open";
    const res = await blightApi.listBlights({
      params: { projectId: project.id },
      query: { includeResolved: !openOnly },
    });
    // Push the freshest open-count to the sidebar badge atom. Write-only:
    // this component never reads the badge, so it must NOT subscribe to it —
    // subscribing here (via useStore) re-rendered this component on every
    // fetch, which (with an inline `fetch` prop) span the table into an
    // infinite refetch loop. `store.set` updates the atom without subscribing.
    alepha.store.set(currentBlightCountAtom, { count: res.openCount });
    setSigilOptions(res.sigils);

    const stored = filters?.sigilId;
    // ⚠️ `"all"` is a value this filter no longer has, and it is still on the
    // machine of anyone who used the inbox before feedback #2098 - filters
    // persist per `persistenceKey`, and `reconcilePersistedFilters` reshapes
    // containers rather than values, so it arrives here untouched. Read as
    // absent: no blight carries it, so the alternative is an empty table
    // under a trigger that says "All apps", which is the worst of both.
    const sigilId = stored === "all" ? undefined : stored;
    const resolvedOnly = statuses.length === 1 && statuses[0] === "resolved";
    const statusFiltered = resolvedOnly
      ? res.items.filter((b) => b.status === "resolved")
      : res.items;
    const filtered = sigilId
      ? statusFiltered.filter((b) => b.sigilId === sigilId)
      : statusFiltered;
    const rows = sortBlights(filtered, sort);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <DataTable<BlightResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey={project ? `lor.blights.${project.id}` : "lor.blights"}
        defaultSort={{ field: "count", direction: "desc" }}
        emptyMessage={tr("blights.empty")}
        filters={{
          fields: filterFields,
          initialValues: { status: ["open"] },
        }}
        // ⚠️ `toolbar`, not `actions`: `AgentPromptsMenu` is a dropdown
        // trigger rather than a button that acts on click, which is the
        // distinction `DataTable`'s own note draws between the two slots.
        //
        // Two switches, like the feedback inbox: the menu renders nothing
        // when the project has `agentPrompts` off, and this passes no items
        // when Apps is off, so both have to be on for anything to appear.
        toolbar={
          <AgentPromptsMenu
            items={
              appsEnabled
                ? [
                    {
                      kind: "blightTriage" as const,
                      subject: () => promptSubject.forBlightsInbox(),
                    },
                  ]
                : []
            }
          />
        }
        fetch={fetchBlights}
        // The bulk bar is triage too: a rank that may not resolve one blight
        // may not delete twenty.
        bulkActions={
          !canTriage
            ? []
            : [
                {
                  icon: Trash2,
                  label: tr("blights.action.deleteSelected"),
                  destructive: true,
                  // Hidden while a triage verb runs: the bulk bar has no
                  // disabled state, and a second click would be dropped by
                  // `run()` without a word.
                  visible: () => !busy,
                  onClick: (selected, ctx) =>
                    void deleteManyAction.run(selected, ctx),
                },
              ]
        }
        columns={{
          error: {
            label: tr("blights.col.error"),
            className: "max-w-[420px]",
            cell: (b) => (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Attacker-controlled — plain text, escaped by React. */}
                  <span className="font-medium">{b.name}</span>
                  <Badge
                    variant={b.origin === "server" ? "default" : "outline"}
                  >
                    {tr(`blights.origin.${b.origin}`)}
                  </Badge>
                  {renderStatus(b.status)}
                </div>
                <p className="text-muted-foreground line-clamp-2 break-words">
                  {b.message}
                </p>
              </div>
            ),
          },
          app: {
            label: tr("blights.col.app"),
            className: "max-w-[180px]",
            // The app that reported the blight most recently, linked to its
            // page, named "lore/production" the way the filter lists it. A
            // blight whose sigil was deleted keeps a null `sigilId`.
            cell: (b) => {
              const name = sigilOptions.find((s) => s.id === b.sigilId)?.label;
              const parts = name ? sigilNameParts(name) : undefined;
              if (!project || !parts) {
                return <span className="text-muted-foreground text-xs">-</span>;
              }
              return (
                <Link
                  href={router.path("app", {
                    params: {
                      projectSlug: project.slug,
                      app: parts.app,
                      env: parts.env,
                    },
                  })}
                  className="block truncate hover:underline"
                >
                  {name}
                </Link>
              );
            },
          },
          page: {
            label: tr("blights.col.page"),
            className: "max-w-[260px]",
            // A link out for an http(s) page, text for a route pattern or a
            // job name (feedback #P2200); the scheme check lives in the cell.
            cell: (b) => <BlightSourceCell sourceUrl={b.sourceUrl} />,
          },
          count: {
            label: tr("blights.col.count"),
            sortable: true,
            align: "right",
            cell: (b) => <span className="tabular-nums">{b.count}</span>,
          },
          lastSeenAt: {
            label: tr("blights.col.lastSeen"),
            sortable: true,
            // This column was the reference implementation - relative label,
            // exact date on hover - and `TimeAgo` is that pattern extracted.
            // Its own `title` went with the span: two titles means the outer
            // one never shows.
            cell: (b) => (
              <TimeAgo
                value={b.lastSeenAt}
                className="text-muted-foreground whitespace-nowrap"
              />
            ),
          },
        }}
        rowActions={(b) => {
          const triaged =
            b.status === "resolved" || b.status.startsWith(QUEST_STATUS_PREFIX);
          return [
            {
              icon: FileText,
              label: tr("blights.action.viewStack"),
              onClick: () => setStackView(b),
            },
            // ⚠️ Triage is `blight:triage`. A rank without it reads the
            // inbox and the stack traces and is offered no verb - off the
            // ACTION, so nothing here repeats a permission string.
            ...(triaged || !canTriage
              ? []
              : [
                  {
                    icon: CheckCircle2,
                    label: tr("blights.action.resolve"),
                    disabled: () => busy,
                    onClick: (
                      blight: BlightResource,
                      { refresh }: { refresh: () => void },
                    ) => void resolveAction.run(blight, refresh),
                  },
                  {
                    icon: Send,
                    label: tr("blights.action.forward"),
                    disabled: () => busy,
                    onClick: (
                      blight: BlightResource,
                      { refresh }: { refresh: () => void },
                    ) => void forwardAction.run(blight, refresh),
                  },
                ]),
            ...(!canTriage
              ? []
              : [
                  {
                    icon: Trash2,
                    label: tr("blights.action.delete"),
                    destructive: true,
                    disabled: () => busy,
                    onClick: (
                      blight: BlightResource,
                      { refresh }: { refresh: () => void },
                    ) => void deleteAction.run(blight, refresh),
                  },
                ]),
          ];
        }}
      />

      <Dialog
        open={stackView !== null}
        onOpenChange={(open) => {
          if (!open) setStackView(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {stackView?.name}: {stackView?.message}
            </DialogTitle>
          </DialogHeader>
          {stackView?.sourceUrl && (
            <p className="text-muted-foreground text-xs break-all">
              {stackView.sourceUrl}
            </p>
          )}
          <pre className="bg-muted max-h-[60vh] overflow-auto rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap">
            {stackView?.stack || "—"}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectBlights;

/**
 * Client-side sort over the deduped blight list. Supports the two sortable
 * columns (`count`, `lastSeenAt`); anything else falls back to count desc.
 */
const sortBlights = (
  items: BlightResource[],
  sort?: string,
): BlightResource[] => {
  const field = sort?.replace(/^-/, "") ?? "count";
  const dir = sort?.startsWith("-") ? -1 : 1;
  const rows = [...items];
  rows.sort((a, b) => {
    if (field === "lastSeenAt") {
      return (
        (new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()) *
        dir
      );
    }
    // Default + explicit `count`.
    return (a.count - b.count) * (sort ? dir : -1);
  });
  return rows;
};

/**
 * Empty `Page` returned before the project atom is hydrated.
 */
const emptyPage = (page: number, size: number): Page<BlightResource> => ({
  content: [],
  page: {
    number: page,
    size,
    offset: page * size,
    numberOfElements: 0,
    totalElements: 0,
    totalPages: 1,
    isEmpty: true,
    isFirst: page === 0,
    isLast: true,
  },
});
