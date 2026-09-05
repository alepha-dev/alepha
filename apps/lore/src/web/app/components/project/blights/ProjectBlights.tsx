import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Page, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
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
import { formatReference } from "../../shared/element/typedReference.ts";
import FilterSlot from "../../shared/FilterSlot.tsx";

/**
 * Filter form, owned by AlephaTable: a status multi-select (open / resolved,
 * empty meaning both) and a sigil select (`"all"` or a sigil id). Both are
 * applied client-side over the already-fetched list.
 */
const blightsFiltersSchema = z.object({
  /**
   * An ARRAY, and empty means every status (feedback #2092).
   *
   * ⚠️ `all` left the ENUM, not just the dropdown. It was a value standing in
   * for the absence of a filter, which the convention expresses as an empty
   * selection - and while it was a state, `fetchBlights` had to branch on it
   * as though a blight could BE "all".
   *
   * The default is still `["open"]`, so the inbox opens on the triage queue
   * rather than on its whole history.
   */
  status: z.array(z.enum(["open", "resolved"])).optional(),
  /**
   * Absent means every app, the same way an empty `status` means every
   * status. It carried a literal `"all"` until feedback #2098: the select
   * drew it as a row of its own, so "All sigils" sat in the list looking
   * like an app you could pick, and `fetchBlights` had to branch on a
   * sigil id that is not one.
   */
  sigilId: z.string().optional(),
});

/**
 * Owner-facing Blights inbox, built on {@link AlephaTable}.
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
  const alepha = useAlepha();
  const blightApi = useClient<BlightController>();
  const toaster = useToast();
  const dialog = useDialog();
  const dt = useInject(DateTimeProvider);

  const [stackView, setStackView] = useState<BlightResource | null>(null);
  // Sigil options for the "filter by sigil" dropdown, hydrated from the list
  // response rather than from `SigilController.listSigils`: the filter needs
  // id + label, and that endpoint hands back the whole credential row
  // (token prefix, kinds, creator) for a dropdown. One request, one shape,
  // nothing extra on the wire.
  const [sigilOptions, setSigilOptions] = useState<
    { id: string; label: string }[]
  >([]);

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

  // Fetch the full list, keep the sidebar badge in sync, then sort + slice
  // client-side into the `Page` shape AlephaTable consumes.
  const fetchBlights = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: Record<string, any>;
  }): Promise<Page<BlightResource>> => {
    if (!project) {
      return emptyPage(page, size);
    }
    // Open-only (the default) hides resolved and forwarded rows server-side.
    // Anything else needs the full set, with `resolved` narrowed client-side:
    // an empty selection now means every status, which is the case the old
    // `"all"` value used to name.
    const statuses = (filters?.status as string[] | undefined) ?? [];
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

    const stored = filters?.sigilId as string | undefined;
    // ⚠️ `"all"` is a value this filter no longer has, and it is still on the
    // machine of anyone who used the inbox before feedback #2098 - filters
    // persist per `persistenceKey`, and `reconcilePersistedFilters` reshapes
    // containers rather than values, so it arrives here untouched. Read as
    // absent: no blight carries it, so the alternative is an empty table
    // under a trigger that says "All sigils", which is the worst of both.
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
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <AlephaTable<BlightResource>
        className="min-h-0 flex-1"
        persistenceKey={project ? `lor.blights.${project.id}` : "lor.blights"}
        defaultSort={{ field: "count", direction: "desc" }}
        emptyMessage={tr("blights.empty")}
        filters={{
          schema: blightsFiltersSchema,
          initialValues: { status: ["open"] },
          render: (form) => (
            <div className="flex gap-2">
              <FilterSlot>
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel={tr("blights.filter.all")}
                  countLabel={(n) =>
                    String(
                      tr("blights.filter.statusCount", { args: [String(n)] }),
                    )
                  }
                  triggerClassName="w-full"
                  items={[
                    { label: tr("blights.filter.open"), value: "open" },
                    { label: tr("blights.filter.resolved"), value: "resolved" },
                  ]}
                />
              </FilterSlot>
              <div className="w-52">
                <Control
                  input={form.input.sigilId}
                  label=""
                  clearable
                  icon={AppWindow}
                  clearLabel={tr("blights.filter.allSigils")}
                  triggerClassName="w-full"
                  items={sigilOptions.map((s) => ({
                    label: s.label,
                    value: s.id,
                  }))}
                />
              </div>
            </div>
          ),
        }}
        fetch={fetchBlights}
        bulkActions={[
          {
            icon: Trash2,
            label: tr("blights.action.deleteSelected"),
            destructive: true,
            onClick: async (selected, { refresh, clearSelection }) => {
              if (!project || selected.length === 0) return;
              const ok = await dialog.confirm({
                title: tr("blights.deleteSelectedConfirm", {
                  args: [String(selected.length)],
                }) as string,
                confirmLabel: tr("blights.action.delete"),
                cancelLabel: tr("common.cancel"),
                destructive: true,
              });
              if (!ok) return;
              try {
                const res = await blightApi.deleteBlights({
                  params: { projectId: project.id },
                  body: { ids: selected.map((b) => b.id) },
                });
                toaster.success(
                  tr("blights.toast.deletedMany", {
                    args: [String(res.deleted)],
                  }),
                );
                clearSelection();
                refresh();
              } catch (error) {
                toaster.error(
                  error instanceof Error ? error.message : String(error),
                );
              }
            },
          },
        ]}
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
          page: {
            label: tr("blights.col.page"),
            className: "max-w-[260px]",
            cell: (b) =>
              b.sourceUrl ? (
                <span
                  className="text-muted-foreground block truncate text-xs"
                  title={b.sourceUrl}
                >
                  {b.sourceUrl}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              ),
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
            cell: (b) => (
              <span
                className="text-muted-foreground whitespace-nowrap"
                title={formatDate(b.lastSeenAt)}
              >
                {dt.of(b.lastSeenAt).fromNow()}
              </span>
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
            ...(triaged
              ? []
              : [
                  {
                    icon: CheckCircle2,
                    label: tr("blights.action.resolve"),
                    onClick: async (
                      blight: BlightResource,
                      { refresh }: { refresh: () => void },
                    ) => {
                      if (!project) return;
                      try {
                        await blightApi.resolveBlight({
                          params: {
                            projectId: project.id,
                            blightId: blight.id,
                          },
                        });
                        toaster.success(tr("blights.toast.resolved"));
                        refresh();
                      } catch (error) {
                        toaster.error(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    },
                  },
                  {
                    icon: Send,
                    label: tr("blights.action.forward"),
                    onClick: async (
                      blight: BlightResource,
                      { refresh }: { refresh: () => void },
                    ) => {
                      if (!project) return;
                      try {
                        const res = await blightApi.forwardBlightToQuest({
                          params: {
                            projectId: project.id,
                            blightId: blight.id,
                          },
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
                      } catch (error) {
                        toaster.error(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    },
                  },
                ]),
            {
              icon: Trash2,
              label: tr("blights.action.delete"),
              destructive: true,
              onClick: async (
                blight: BlightResource,
                { refresh }: { refresh: () => void },
              ) => {
                if (!project) return;
                const ok = await dialog.confirm({
                  title: tr("blights.deleteConfirm"),
                  confirmLabel: tr("blights.action.delete"),
                  cancelLabel: tr("common.cancel"),
                  destructive: true,
                });
                if (!ok) return;
                try {
                  await blightApi.deleteBlight({
                    params: { projectId: project.id, blightId: blight.id },
                  });
                  toaster.success(tr("blights.toast.deleted"));
                  refresh();
                } catch (error) {
                  toaster.error(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              },
            },
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
 * Format an ISO timestamp for the `title` tooltip, falling back to raw.
 */
const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

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
