import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { type Page, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Layers, User, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { ProjectActivityRow } from "@/api/schemas/projectActivityRowSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { capabilityRegistry } from "../../../services/capabilityRegistry.ts";
import { displayName } from "../../../services/displayName.ts";
import type { I18n } from "../../../services/I18n.ts";
import FilterSlot from "../../shared/FilterSlot.tsx";
import { activityResourceHref } from "./activityResourceHref.ts";

const activityFiltersSchema = z.object({
  /**
   * One person at a time, deliberately. A person picker answering "what did
   * SHE change" is a different question from "which kinds of thing moved",
   * and a list of two people is a report nobody asks for.
   */
  userId: z.string().optional(),
  /**
   * ARRAYS, and empty means every value (feedback #2092). Both are the
   * multi-select case: "quests and epics" and "created or deleted" are
   * questions a reader has, and a single value could not express either.
   */
  type: z.array(z.string()).optional(),
  action: z.array(z.string()).optional(),
});

/**
 * What happened in this project: one row per recorded write, newest first.
 *
 * ## It is a table, and that is the whole point
 *
 * The page it replaces was a hand-rolled feed over `ProjectActivityService`,
 * which derived events at read time from six range scans and unioned them in
 * JS. Nothing about that could sort, page or filter on the server, so the page
 * grew a WINDOW control (3h / 24h / 7d / 30d) and four client-side chips
 * instead - controls that existed to work around the data shape rather than to
 * answer a question anybody had. `audits` scoped to this project is a real
 * table with real indexes, so this is a real table: server-side sort, server
 * -side paging, server-side filters on the three columns worth filtering.
 *
 * ## No polling, ever
 *
 * `AlephaTable` fetches on mount and on an explicit refresh, and there is
 * deliberately no interval. The QuestGraph incident (folio #1057) was a route
 * loader revalidating once per second for 51 minutes, producing 4,009
 * identical `/api/_batch` requests from one browser tab - roughly 35% of that
 * day's account-wide Worker invocations. This is a page a project opens on, so
 * it is the worst possible place to reintroduce that.
 *
 * ## The three filters are the three questions
 *
 * Who (an account), resource (the `type` column: quest, epic, release, ...)
 * and what (the `action` column: create, complete, publish, ...). Each is one
 * indexed column behind the `(scopeType, scopeId)` prefix, so a filter is a
 * seek and not a scan.
 */
const ProjectActivityPage = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const projectApi = useClient<ProjectController>();
  const dt = useInject(DateTimeProvider);

  const [people, setPeople] = useState<{ id: string; label: string }[]>([]);
  const [options, setOptions] = useState<{
    types: string[];
    actions: string[];
  }>({ types: [], actions: [] });

  // The two dropdowns' contents, fetched once per project. The actions come
  // from the `$audit` DECLARATIONS rather than from the rows, so the list is
  // complete on a project's first day instead of growing under the reader as
  // things happen for the first time.
  useEffect(() => {
    if (!project) return;
    let alive = true;
    void Promise.all([
      projectApi.getProjectUsers({ params: { id: project.id } }),
      projectApi.getProjectActivityFilters({ params: { id: project.id } }),
    ])
      .then(([users, filters]) => {
        if (!alive) return;
        setPeople(
          users.map((user) => ({
            id: user.id,
            label: displayName(user, user.id),
          })),
        );
        setOptions(filters);
      })
      .catch(() => {
        // A filter bar that could not be filled costs the filters, not the
        // table: the rows below are a separate request and still render.
      });
    return () => {
      alive = false;
    };
  }, [project, projectApi]);

  const fetchActivity = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: Record<string, any>;
  }): Promise<Page<ProjectActivityRow>> => {
    if (!project) {
      return emptyPage(page, size);
    }
    return await projectApi.getProjectActivity({
      params: { id: project.id },
      query: {
        page,
        size,
        sort,
        // `""` is what a cleared Control sends, and it is not a filter: sent
        // through, it would select the rows whose column is the empty string,
        // which is none of them.
        userId: filters?.userId || undefined,
        // Comma-joined, which `AuditService.find` splits back into one
        // condition. A single value still produces the `eq` it always did.
        type: filters?.type?.length ? filters.type.join(",") : undefined,
        action: filters?.action?.length ? filters.action.join(",") : undefined,
      },
    });
  };

  if (!project) {
    return null;
  }

  return (
    // No heading, deliberately. The breadcrumb leaf already reads Activity,
    // and no sibling list page has one: Quests, Epics, Blights and Folios all
    // open straight into their toolbar (feedback #2090). If that pattern is
    // ever revisited the answer is a visually-hidden heading, not this one
    // back.
    // ⚠️ `p-4` flat, with no `md:p-6`. This page was the only table page
    // whose padding scaled with the viewport, so above `md` it sat 8px
    // further from the edge than Epics, Releases, Blights and Apps, which is
    // what made it read as random rather than as a rule (feedback #2099).
    // Below `md` the two already agreed, which is why it was invisible in a
    // narrow window. Epics is the baseline the report named.
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <AlephaTable<ProjectActivityRow>
        className="min-h-0 flex-1"
        persistenceKey={`lor.activity.${project.id}`}
        // Newest first, which is the question somebody opening this page is
        // asking. The column is sortable, so the other direction is one click.
        defaultSort={{ field: "createdAt", direction: "desc" }}
        emptyMessage={tr("activity.empty")}
        fetch={fetchActivity}
        filters={{
          schema: activityFiltersSchema,
          render: (form) => (
            <div className="flex flex-wrap gap-2">
              <FilterSlot>
                <Control
                  input={form.input.userId}
                  label=""
                  clearable
                  icon={User}
                  clearLabel={String(tr("activity.filter.allPeople"))}
                  triggerClassName="w-full"
                  items={people.map((person) => ({
                    label: person.label,
                    value: person.id,
                  }))}
                />
              </FilterSlot>
              <FilterSlot>
                <Control
                  input={form.input.type}
                  label=""
                  clearable
                  icon={Layers}
                  clearLabel={String(tr("activity.filter.allResources"))}
                  countLabel={(n) =>
                    String(
                      tr("activity.filter.typeCount", { args: [String(n)] }),
                    )
                  }
                  triggerClassName="w-full"
                  items={options.types.map((type) => ({
                    label: resourceLabel(tr, type),
                    value: type,
                  }))}
                />
              </FilterSlot>
              <FilterSlot>
                <Control
                  input={form.input.action}
                  label=""
                  clearable
                  icon={Zap}
                  clearLabel={String(tr("activity.filter.allActions"))}
                  countLabel={(n) =>
                    String(
                      tr("activity.filter.actionCount", { args: [String(n)] }),
                    )
                  }
                  triggerClassName="w-full"
                  items={options.actions.map((action) => ({
                    label: action,
                    value: action,
                  }))}
                />
              </FilterSlot>
            </div>
          ),
        }}
        columns={{
          createdAt: {
            label: tr("activity.col.when"),
            sortable: true,
            cell: (row) => (
              <span
                className="text-muted-foreground text-xs whitespace-nowrap"
                // The absolute stamp on hover, because "3 days ago" is the
                // right default and the wrong answer when somebody is
                // reconstructing a sequence.
                // A coalesced row names its SPAN, not just its start: the
                // relative time is the first event, and without the end the
                // reader cannot tell a single edit from twenty minutes of
                // them. `updatedAt` is absent on a row standing for one
                // event, where the start is the whole story.
                title={
                  row.updatedAt
                    ? `${dt.of(row.createdAt).format("lll")} → ${dt
                        .of(row.updatedAt)
                        .format("lll")}`
                    : String(dt.of(row.createdAt).format("lll"))
                }
              >
                {String(l(row.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          actor: {
            label: tr("activity.col.who"),
            cell: (row) => (
              <span className="text-sm">
                {row.actor ?? tr("activity.actor.unknown")}
              </span>
            ),
          },
          action: {
            label: tr("activity.col.what"),
            cell: (row) => (
              <Badge variant="secondary" className="font-mono text-xs">
                {row.action}
                {/* A burst that `$audit`'s `coalesce` folded (#1872). Ten
                    edits to one folio in twenty minutes used to be ten
                    near-identical rows, and a reader learned nothing from
                    the ninth. Hidden at 1, which is every row an app that
                    never opted in ever writes. */}
                {(row.eventCount ?? 1) > 1 && (
                  <span className="text-muted-foreground ml-1 tabular-nums">
                    ×{row.eventCount}
                  </span>
                )}
              </Badge>
            ),
          },
          resource: {
            label: tr("activity.col.resource"),
            cell: (row) => {
              const href = activityResourceHref(project.slug, row);
              const label =
                `${resourceLabel(tr, row.type)} ${row.resourceId ?? ""}`.trim();
              const title = row.description;
              if (!href) {
                return (
                  <span className="text-sm">
                    {label}
                    {title ? (
                      <span className="text-muted-foreground"> {title}</span>
                    ) : null}
                  </span>
                );
              }
              return (
                <button
                  type="button"
                  // The row's own snapshot of the title, never a live lookup:
                  // a quest renamed after the fact must not rewrite what the
                  // feed says happened.
                  title={title}
                  onClick={() => router.push(href as never)}
                  className="hover:text-primary inline-flex max-w-[420px] items-center gap-1.5 truncate text-left text-sm underline-offset-2 hover:underline"
                >
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {label}
                  </span>
                  {title ? <span className="truncate">{title}</span> : null}
                </button>
              );
            },
          },
          details: {
            label: tr("activity.col.details"),
            cell: (row) => {
              // A capability row names the switch and its new state. It has
              // no `fields`, because nothing on the project row changed - the
              // event is a `project_capabilities` row appearing or going.
              const capability = row.metadata?.capability;
              if (typeof capability === "string") {
                const descriptor = capabilityRegistry.find(capability);
                return (
                  <span className="text-muted-foreground text-xs">
                    {tr(
                      row.metadata?.enabled
                        ? "activity.capability.enabled"
                        : "activity.capability.disabled",
                      {
                        args: [
                          descriptor
                            ? String(tr(descriptor.labelKey as never))
                            : capability,
                        ],
                      },
                    )}
                  </span>
                );
              }

              const fields = row.metadata?.fields;
              if (!Array.isArray(fields) || fields.length === 0) {
                return null;
              }
              return (
                <span className="text-muted-foreground text-xs">
                  {tr("activity.fields", { args: [fields.join(", ")] })}
                </span>
              );
            },
          },
        }}
      />
    </div>
  );
};

export default ProjectActivityPage;

/**
 * A resource kind in the reader's language, falling back to the raw value.
 *
 * The fallback is load-bearing rather than defensive: a new `$audit` type
 * reaches this page the moment it is declared, before anybody has written its
 * label, and printing `sigil` beats printing a missing translation key.
 */
const resourceLabel = (
  tr: (key: any, options?: any) => string | number,
  type: string,
): string =>
  String(tr(`activity.resource.${type}` as never, { default: type }));

/**
 * The shape `AlephaTable` expects when there is nothing to fetch yet.
 */
const emptyPage = <T,>(page: number, size: number): Page<T> => ({
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
