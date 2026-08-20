import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Page, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  CircleDot,
  Plus,
  Search,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentEpicCountAtom } from "@/web/app/atoms/currentEpicCountAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import EpicCreateSheet from "./EpicCreateSheet.tsx";
import { STATUS_BADGE_VARIANT, STATUS_LABEL_KEYS } from "./epicStatus.ts";
import ProjectEpicsProgress from "./ProjectEpicsProgress.tsx";

/**
 * Filter form, owned by AlephaTable: free-text over title + description,
 * and a status select whose cleared state means "all".
 */
const epicsFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["planned", "active", "done"]).optional(),
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
 * Status is a read-only badge here. Changing it is the Epic detail page's
 * job (`EpicStatusControl.tsx`) — this list intentionally does not
 * duplicate that control or its transition-verb vocabulary, which is why
 * the row menu offers Open and Delete and nothing between them.
 *
 * Each row's title links to `projectEpic` (`/epics/:epicNumber`).
 */
const ProjectEpics = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const router = useRouter<AppRouter>();
  const epicApi = useClient<EpicController>();
  const dt = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);
  const alepha = useAlepha();

  const [createOpen, setCreateOpen] = useState(false);
  // Bumped after a create, which happens outside the table and so has no
  // `ctx.refresh()` of its own to call.
  const [reload, setReload] = useState(0);

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

    const status = filters?.status as EpicResource["status"] | undefined;
    const needle = String(filters?.search ?? "")
      .trim()
      .toLowerCase();
    const rows = sortEpics(
      all.filter((epic) => {
        if (status && epic.status !== status) return false;
        if (!needle) return true;
        return (
          epic.title.toLowerCase().includes(needle) ||
          epic.description.toLowerCase().includes(needle) ||
          String(epic.number) === needle.replace(/^#/, "")
        );
      }),
      sort,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <AlephaTable<EpicResource>
        className="min-h-0 flex-1"
        defaultSize={20}
        persistenceKey={`lor.epics.${project.id}`}
        defaultSort={{ field: "updatedAt", direction: "desc" }}
        emptyMessage={tr("epic.list.empty")}
        refreshSignal={reload}
        filters={{
          schema: epicsFiltersSchema,
          render: (form) => (
            <>
              <div className="w-56">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={tr("epic.filter.search")}
                  inputProps={{ "aria-label": tr("epic.filter.search") }}
                />
              </div>
              <div className="w-44">
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel={tr("epic.filter.allStatuses")}
                  triggerClassName="w-full"
                  items={[
                    { label: tr("epic.status.planned"), value: "planned" },
                    { label: tr("epic.status.active"), value: "active" },
                    { label: tr("epic.status.done"), value: "done" },
                  ]}
                  inputProps={{ "aria-label": tr("epic.filter.status") }}
                />
              </div>
            </>
          ),
        }}
        fetch={fetchEpics}
        actions={[
          {
            icon: Plus,
            label: tr("epic.create"),
            onClick: () => setCreateOpen(true),
          },
        ]}
        columns={{
          number: {
            label: tr("epic.list.column.number"),
            sortable: true,
            className: "w-16",
            cell: (epic) => (
              <span className="text-muted-foreground tabular-nums">
                #{epic.number}
              </span>
            ),
          },
          title: {
            label: tr("epic.list.column.title"),
            sortable: true,
            className: "max-w-[520px]",
            cell: (epic) => (
              <div className="flex flex-col gap-0.5">
                <Link
                  href={router.path("projectEpic", {
                    params: { epicNumber: epic.number },
                  })}
                  className="font-medium hover:underline"
                >
                  {epic.title}
                </Link>
                {epic.description ? (
                  <p className="text-muted-foreground line-clamp-1 text-xs break-words">
                    {epic.description}
                  </p>
                ) : null}
              </div>
            ),
          },
          status: {
            label: tr("epic.list.column.status"),
            sortable: true,
            className: "w-32",
            cell: (epic) => (
              <Badge variant={STATUS_BADGE_VARIANT[epic.status]}>
                {tr(STATUS_LABEL_KEYS[epic.status])}
              </Badge>
            ),
          },
          progress: {
            label: tr("epic.list.column.progress"),
            className: "w-56",
            cell: (epic) => <ProjectEpicsProgress epic={epic} />,
          },
          updatedAt: {
            label: tr("epic.list.column.updated"),
            sortable: true,
            className: "w-32",
            cell: (epic) => (
              <span className="text-muted-foreground whitespace-nowrap">
                {dt.of(epic.updatedAt).fromNow()}
              </span>
            ),
          },
        }}
        rowActions={(_epic) => [
          {
            icon: SquareArrowOutUpRight,
            label: tr("epic.action.open"),
            onClick: (epic: EpicResource) => {
              router.push("projectEpic", {
                params: { epicNumber: String(epic.number) },
              });
            },
          },
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
const sortEpics = (items: EpicResource[], sort?: string): EpicResource[] => {
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
    if (field === "number") {
      return (a.number - b.number) * dir;
    }
    return a.number - b.number;
  });
  return rows;
};

/**
 * Sorting `status` alphabetically would read as arbitrary (active, done,
 * planned). This orders it along the lifecycle instead, so ascending walks
 * an epic's life from specified to finished.
 */
const STATUS_ORDER: Record<EpicResource["status"], number> = {
  planned: 0,
  active: 1,
  done: 2,
};
