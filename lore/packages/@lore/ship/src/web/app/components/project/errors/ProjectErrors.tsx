import {
  TimeAgo,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useDialog,
  useToast,
  cn,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import {
  type BulkActionContext,
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import {
  currentProjectAtom,
  type I18n,
  formatReference,
  LoreEmptyState,
  PinnedPromptsButton,
  StackTraceViewer,
} from "@lore/core/web";
import { type Page, z } from "alepha";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  AppWindow,
  CheckCircle2,
  CircleDot,
  FileText,
  Globe,
  Send,
  Server,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { ProjectErrorController } from "../../../../../api/controllers/ProjectErrorController.ts";
import { QUEST_STATUS_PREFIX } from "../../../../../api/schemas/projectErrorQuestStatus.ts";
import type { ProjectErrorResource } from "../../../../../api/schemas/projectErrorResourceSchema.ts";
import { currentErrorCountAtom } from "../../../atoms/currentErrorCountAtom.ts";
import ErrorLinkedLine from "./ErrorLinkedLine.tsx";
import ErrorSourceCell from "./ErrorSourceCell.tsx";
import ErrorTrustIcon from "./ErrorTrustIcon.tsx";
import { sigilNameParts } from "./sigilNameParts.ts";

/**
 * Owner-facing Errors inbox, built on {@link DataTable}.
 *
 * The `listProjectErrors` endpoint returns the full deduplicated list (crashes are
 * folded by root cause, so the row count stays small), so sort + paging are
 * applied client-side here rather than round-tripping the server.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are 100%
 * attacker-controlled. They are rendered ONLY via plain React text
 * interpolation (`{value}`) — React escapes it. NEVER MarkdownView /
 * dangerouslySetInnerHTML. See folio #12.
 */
const ProjectErrors = () => {
  const { tr } = useI18n<I18n, "en">();
  // Untyped on purpose: a forwarded error opens `projectQuest`, a Work page,
  // and Deploy's own program registers only Deploy's and core's routers.
  const router = useRouter<any>();
  const [project] = useStore(currentProjectAtom);
  const alepha = useAlepha();
  const projectErrorApi = useClient<ProjectErrorController>();
  const canTriage = projectErrorApi.resolveProjectError.can();
  const toaster = useToast();
  const dialog = useDialog();

  const [stackView, setStackView] = useState<ProjectErrorResource | null>(null);
  // Sigil options for the "filter by sigil" dropdown, hydrated from the list
  // response rather than from `SigilController.listSigils`: the filter needs
  // id + label, and that endpoint hands back the whole credential row
  // (token prefix, kinds, creator) for a dropdown. One request, one shape,
  // nothing extra on the wire.
  const [sigilOptions, setSigilOptions] = useState<
    { id: string; label: string }[]
  >([]);
  // Every row the last fetch returned, before the filters: a row's linked
  // error (#Q4404) opens from it even when a filter hides it.
  const [fetched, setFetched] = useState<ProjectErrorResource[]>([]);
  // Whether the filters hide open errors: one app's only, or resolved rows
  // only. An empty page there is "no match", the table's own state; anywhere
  // else it means no open error is left, which the companion says.
  const [narrowed, setNarrowed] = useState(false);

  // One `useAction` per triage verb (#E59, #Q2329). A refusal is the server's
  // sentence, toasted by the root `ActionErrorToaster`; follow-ups (the
  // refresh, the navigation) run inside the handler, so none follows a
  // failure.
  const deleteManyAction = useAction<
    [selected: ProjectErrorResource[], ctx: BulkActionContext],
    void
  >(
    {
      handler: async (_ctx, selected, ctx) => {
        if (!project || selected.length === 0) return;
        const ok = await dialog.confirm({
          title: tr("errors.deleteSelectedConfirm", {
            args: [String(selected.length)],
          }),
          confirmLabel: tr("errors.action.delete"),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return;
        const res = await projectErrorApi.deleteProjectErrors({
          params: { projectId: project.id },
          body: { ids: selected.map((b) => b.id) },
        });
        toaster.success(
          tr("errors.toast.deletedMany", {
            args: [String(res.deleted)],
          }),
        );
        ctx.clearSelection();
        ctx.refresh();
      },
    },
    [projectErrorApi, project, dialog, toaster, tr],
  );

  const resolveAction = useAction<
    [projectError: ProjectErrorResource, refresh: () => void],
    void
  >(
    {
      handler: async (_ctx, projectError, refresh) => {
        if (!project) return;
        await projectErrorApi.resolveProjectError({
          params: { projectId: project.id, errorId: projectError.id },
        });
        toaster.success(tr("errors.toast.resolved"));
        refresh();
      },
    },
    [projectErrorApi, project, toaster, tr],
  );

  // A member reads a group and trusts it, so an agent may read it too
  // (#Q4233). Only from a signed-in session: the server refuses any key.
  const trustAction = useAction<
    [projectError: ProjectErrorResource, refresh: () => void],
    void
  >(
    {
      handler: async (_ctx, projectError, refresh) => {
        if (!project) return;
        await projectErrorApi.trustProjectError({
          params: { projectId: project.id, errorId: projectError.id },
        });
        toaster.success(tr("errors.toast.trusted"));
        refresh();
      },
    },
    [projectErrorApi, project, toaster, tr],
  );

  // A member withdraws a group's trust (#Q4255), most often a server group
  // trusted on arrival whose message carries outside input. Session only too.
  const untrustAction = useAction<
    [projectError: ProjectErrorResource, refresh: () => void],
    void
  >(
    {
      handler: async (_ctx, projectError, refresh) => {
        if (!project) return;
        await projectErrorApi.untrustProjectError({
          params: { projectId: project.id, errorId: projectError.id },
        });
        toaster.success(tr("errors.toast.untrusted"));
        refresh();
      },
    },
    [projectErrorApi, project, toaster, tr],
  );

  const forwardAction = useAction<
    [projectError: ProjectErrorResource, refresh: () => void],
    void
  >(
    {
      handler: async (_ctx, projectError, refresh) => {
        if (!project) return;
        const res = await projectErrorApi.forwardProjectErrorToQuest({
          params: { projectId: project.id, errorId: projectError.id },
          body: {},
        });
        toaster.success(
          tr("errors.toast.forwarded", {
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
    [projectErrorApi, project, router, toaster, tr],
  );

  const deleteAction = useAction<
    [projectError: ProjectErrorResource, refresh: () => void],
    void
  >(
    {
      handler: async (_ctx, projectError, refresh) => {
        if (!project) return;
        const ok = await dialog.confirm({
          title: tr("errors.deleteConfirm"),
          confirmLabel: tr("errors.action.delete"),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return;
        await projectErrorApi.deleteProjectError({
          params: { projectId: project.id, errorId: projectError.id },
        });
        toaster.success(tr("errors.toast.deleted"));
        refresh();
      },
    },
    [projectErrorApi, project, dialog, toaster, tr],
  );

  // Page-wide: every triage control waits while any verb runs, since `run()`
  // drops a call made while its own is in flight.
  const busy =
    deleteManyAction.loading ||
    resolveAction.loading ||
    trustAction.loading ||
    untrustAction.loading ||
    forwardAction.loading ||
    deleteAction.loading;

  const renderStatus = (status: string) => {
    if (status === "resolved") {
      return <Badge variant="secondary">{tr("errors.status.resolved")}</Badge>;
    }
    // The status carries the quest's database id after the prefix, not its
    // per-project number, so the badge says only that it was forwarded
    // (epic #32): a `#` before a database id read as a reference nobody had.
    if (status.startsWith(QUEST_STATUS_PREFIX)) {
      return <Badge variant="outline">{tr("errors.status.quest")}</Badge>;
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
     * empty selection - and while it was a state, `fetchProjectErrors` had to branch
     * on it as though an error could BE "all".
     *
     * The default is still `["open"]` (`initialValues` below), so the inbox
     * opens on the triage queue rather than on its whole history, and the
     * filter holding that value keeps it on the bar.
     */
    status: {
      schema: z.array(z.enum(["open", "resolved"])),
      label: tr("errors.filter.status"),
      icon: CircleDot,
      items: [
        { label: tr("errors.filter.open"), value: "open" },
        { label: tr("errors.filter.resolved"), value: "resolved" },
      ],
      control: {
        clearLabel: tr("errors.filter.allStatuses"),
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
      label: tr("errors.filter.sigil"),
      icon: AppWindow,
      items: sigilOptions.map((s) => ({ label: s.label, value: s.id })),
      hidden: sigilOptions.length === 0,
      control: { clearLabel: tr("errors.filter.allApps") },
    },
  } satisfies DataTableFilterFields;

  // Fetch the full list, keep the sidebar badge in sync, then sort + slice
  // client-side into the `Page` shape DataTable consumes.
  const fetchProjectErrors = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: DataTableFilterValues<typeof filterFields>;
  }): Promise<Page<ProjectErrorResource>> => {
    if (!project) {
      return emptyPage(page, size);
    }
    // Open-only (the default) hides resolved and forwarded rows server-side.
    // Anything else needs the full set, with `resolved` narrowed client-side:
    // an empty selection now means every status, which is the case the old
    // `"all"` value used to name.
    const statuses = filters?.status ?? [];
    const openOnly = statuses.length === 1 && statuses[0] === "open";
    const res = await projectErrorApi.listProjectErrors({
      params: { projectId: project.id },
      query: { includeResolved: !openOnly },
    });
    // Push the freshest open-count to the sidebar badge atom. Write-only:
    // this component never reads the badge, so it must NOT subscribe to it —
    // subscribing here (via useStore) re-rendered this component on every
    // fetch, which (with an inline `fetch` prop) span the table into an
    // infinite refetch loop. `store.set` updates the atom without subscribing.
    alepha.store.set(currentErrorCountAtom, { count: res.openCount });
    setSigilOptions(res.sigils);
    setFetched(res.items);

    const stored = filters?.sigilId;
    // ⚠️ `"all"` is a value this filter no longer has, and it is still on the
    // machine of anyone who used the inbox before feedback #2098 - filters
    // persist per `persistenceKey`, and `reconcilePersistedFilters` reshapes
    // containers rather than values, so it arrives here untouched. Read as
    // absent: no error carries it, so the alternative is an empty table
    // under a trigger that says "All apps", which is the worst of both.
    const sigilId = stored === "all" ? undefined : stored;
    const resolvedOnly = statuses.length === 1 && statuses[0] === "resolved";
    const statusFiltered = resolvedOnly
      ? res.items.filter((b) => b.status === "resolved")
      : res.items;
    const filtered = sigilId
      ? statusFiltered.filter((b) => b.sigilId === sigilId)
      : statusFiltered;
    const rows = sortProjectErrors(filtered, sort);
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
      <DataTable<ProjectErrorResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey={project ? `lor.errors.${project.id}` : "lor.errors"}
        defaultSort={{ field: "count", direction: "desc" }}
        // ⚠️ `empty` replaces the no-match state too, so it is passed only
        // while the view still holds every open error. No open error is good
        // news: the companion is `calm`.
        empty={
          narrowed ? undefined : (
            <LoreEmptyState
              mood="calm"
              title={tr("errors.empty.title")}
              description={tr("errors.empty.description")}
            />
          )
        }
        filters={{
          fields: filterFields,
          initialValues: { status: ["open"] },
          onChange: (values) => {
            const statuses = values.status ?? [];
            // `"all"` is the sigil value an old stored filter may still
            // carry: read as absent, as the fetcher does.
            const oneApp = !!values.sigilId && values.sigilId !== "all";
            setNarrowed(
              oneApp || (statuses.length > 0 && !statuses.includes("open")),
            );
          },
        }}
        // ⚠️ `toolbar`, not `actions`: the robot is a dropdown trigger
        // rather than a button that acts on click. It shows the prompts
        // pinned on the Error list (#Q4284).
        toolbar={<PinnedPromptsButton page="errors" />}
        fetch={fetchProjectErrors}
        // The bulk bar is triage too: a rank that may not resolve one error
        // may not delete twenty.
        bulkActions={
          !canTriage
            ? []
            : [
                {
                  icon: Trash2,
                  label: tr("errors.action.deleteSelected"),
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
            label: tr("errors.col.error"),
            className: "max-w-[420px]",
            cell: (b) => (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Attacker-controlled — plain text, escaped by React. */}
                  <span className="font-medium">{b.name}</span>
                  {/* The shared tint Badge, as the quest priority and the
                      feedback status (#Q4261): a tone and a glyph each. */}
                  <Badge
                    variant="tint"
                    tone={b.origin === "server" ? "blue" : "violet"}
                    data-testid="error-origin"
                  >
                    {b.origin === "server" ? (
                      <Server className="size-3" />
                    ) : (
                      <Globe className="size-3" />
                    )}
                    {tr(`errors.origin.${b.origin}`)}
                  </Badge>
                  {renderStatus(b.status)}
                  {(b.trustedAt || b.status === "open") && (
                    <ErrorTrustIcon
                      trusted={!!b.trustedAt}
                      trustedByName={b.trustedByName}
                      onArrival={!!b.trustedAt && !b.trustedBy}
                    />
                  )}
                </div>
                <p className="text-muted-foreground line-clamp-2 break-words">
                  {b.message}
                </p>
                {b.linkedError && (
                  <ErrorLinkedLine
                    label={tr(
                      b.linkedError.origin === "server"
                        ? "errors.linked.causedBy"
                        : "errors.linked.caused",
                      { args: [String(b.linkedError.id)] },
                    )}
                    linked={fetched.find((it) => it.id === b.linkedError?.id)}
                    onOpen={setStackView}
                  />
                )}
              </div>
            ),
          },
          app: {
            label: tr("errors.col.app"),
            className: "max-w-[180px]",
            // The app that reported the error most recently, linked to its
            // page, named "lore/production" the way the filter lists it. A
            // error whose sigil was deleted keeps a null `sigilId`.
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
                  className={cn(
                    textLinkUnderlineClassName,
                    "hover:text-foreground block truncate",
                  )}
                >
                  {name}
                </Link>
              );
            },
          },
          page: {
            label: tr("errors.col.page"),
            className: "max-w-[260px]",
            // A link out for an http(s) page, text for a route pattern or a
            // job name (feedback #P2200); the scheme check lives in the cell.
            cell: (b) => <ErrorSourceCell sourceUrl={b.sourceUrl} />,
          },
          count: {
            label: tr("errors.col.count"),
            sortable: true,
            align: "right",
            cell: (b) => <span className="tabular-nums">{b.count}</span>,
          },
          lastSeenAt: {
            label: tr("errors.col.lastSeen"),
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
              label: tr("errors.action.viewStack"),
              onClick: () => setStackView(b),
            },
            // ⚠️ Triage is `error:triage`. A rank without it reads the
            // inbox and the stack traces and is offered no verb - off the
            // ACTION, so nothing here repeats a permission string.
            ...(triaged || !canTriage
              ? []
              : [
                  ...(b.trustedAt
                    ? [
                        {
                          icon: ShieldOff,
                          label: tr("errors.action.untrust"),
                          disabled: () => busy,
                          onClick: (
                            projectError: ProjectErrorResource,
                            { refresh }: { refresh: () => void },
                          ) => void untrustAction.run(projectError, refresh),
                        },
                      ]
                    : [
                        {
                          icon: ShieldCheck,
                          label: tr("errors.action.trust"),
                          disabled: () => busy,
                          onClick: (
                            projectError: ProjectErrorResource,
                            { refresh }: { refresh: () => void },
                          ) => void trustAction.run(projectError, refresh),
                        },
                      ]),
                  {
                    icon: CheckCircle2,
                    label: tr("errors.action.resolve"),
                    disabled: () => busy,
                    onClick: (
                      projectError: ProjectErrorResource,
                      { refresh }: { refresh: () => void },
                    ) => void resolveAction.run(projectError, refresh),
                  },
                  {
                    icon: Send,
                    label: tr("errors.action.forward"),
                    disabled: () => busy,
                    onClick: (
                      projectError: ProjectErrorResource,
                      { refresh }: { refresh: () => void },
                    ) => void forwardAction.run(projectError, refresh),
                  },
                ]),
            ...(!canTriage
              ? []
              : [
                  {
                    icon: Trash2,
                    label: tr("errors.action.delete"),
                    destructive: true,
                    disabled: () => busy,
                    onClick: (
                      projectError: ProjectErrorResource,
                      { refresh }: { refresh: () => void },
                    ) => void deleteAction.run(projectError, refresh),
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
          <p className="text-muted-foreground text-xs">
            {tr("errors.dialog.number", {
              args: [String(stackView?.id ?? "")],
            })}
            {stackView?.route && <> · {stackView.route}</>}
          </p>
          {stackView?.sourceUrl && (
            <p className="text-muted-foreground text-xs break-all">
              {stackView.sourceUrl}
            </p>
          )}
          {stackView?.linkedError && (
            <ErrorLinkedLine
              label={tr(
                stackView.linkedError.origin === "server"
                  ? "errors.linked.causedBy"
                  : "errors.linked.caused",
                { args: [String(stackView.linkedError.id)] },
              )}
              linked={fetched.find((it) => it.id === stackView.linkedError?.id)}
              onOpen={setStackView}
            />
          )}
          {/* Read, not dumped (#Q4186): one section per error of the chain,
              frames one per line. Plain React text, as above. */}
          <div className="max-h-[60vh] min-w-0 overflow-auto">
            {stackView?.stack ? (
              <StackTraceViewer
                stack={stackView.stack}
                name={stackView.name}
                message={stackView.message}
              />
            ) : (
              <p className="text-muted-foreground text-sm">—</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectErrors;

/**
 * Client-side sort over the deduped error list. Supports the two sortable
 * columns (`count`, `lastSeenAt`); anything else falls back to count desc.
 */
const sortProjectErrors = (
  items: ProjectErrorResource[],
  sort?: string,
): ProjectErrorResource[] => {
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
const emptyPage = (page: number, size: number): Page<ProjectErrorResource> => ({
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
