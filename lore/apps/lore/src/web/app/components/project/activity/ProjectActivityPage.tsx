import { TimeAgo, Badge } from "@alepha/ui";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import { type Page, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Layers, User, Zap } from "lucide-react";
import { useMemo } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { ProjectActivityRow } from "@/api/schemas/projectActivityRowSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { displayName } from "../../../services/displayName.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useProjectUsers } from "../../shared/useProjectUsers.ts";
import { ActivityDetails } from "./ActivityDetails.tsx";
import { activityResourceHref } from "./activityResourceHref.ts";
import { activityResourceIcon } from "./activityResourceIcon.ts";
import { activityResourceLabel, capitalize } from "./activityResourceLabel.ts";

export interface ProjectActivityPageProps {
  resource?: {
    type: string;
    id: string;
  };
  persistenceKey?: string;
}

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
 * `DataTable` fetches on mount and on an explicit refresh, and there is
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
const ProjectActivityPage = ({
  resource,
  persistenceKey,
}: ProjectActivityPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const projectApi = useClient<ProjectController>();
  const dt = useInject(DateTimeProvider);

  // The two dropdowns' contents, fetched once per project (#E59, #Q2329). The
  // members come through `useProjectUsers`, so the request is shared with
  // every other surface that names a member. The actions come from the
  // `$audit` DECLARATIONS rather than from the rows, so the list is complete
  // on a project's first day instead of growing under the reader as things
  // happen for the first time.
  //
  // Both are quiet on purpose: a filter bar that could not be filled costs
  // the filters, not the table, and the rows below are a separate request
  // that still renders. `onError` keeps the failure out of the toaster and in
  // error reporting.
  const users = useProjectUsers();
  const people = useMemo(
    () =>
      users.map((user) => ({
        id: user.id,
        label: displayName(user, user.id),
      })),
    [users],
  );
  const options = useQuery(
    {
      key: ["project-activity-filters", project?.id],
      enabled: !!project,
      handler: () =>
        projectApi.getProjectActivityFilters({
          params: { id: project?.id as number },
        }),
      onError: () => {},
    },
    [projectApi, project?.id],
  ).data ?? { types: [], actions: [], pairs: [] };

  /**
   * Whether the people filter is offered at all (feedback #P2178).
   *
   * Not on a one-member project, where it lists the owner alone and can only
   * ever select every row; and not before the member list has landed, rather
   * than rendering an empty control that may then vanish. Read off the list
   * the dropdown is filled from, so the decision costs no request.
   *
   * ⚠️ Hidden, and a stored `userId` still applies. It used to be dropped by
   * the fetch while the control was hidden, so it could not narrow the table
   * with nothing on screen to clear it. The bar now draws a hidden filter
   * that holds a value (#E58), which answers the same problem where it
   * starts: the filter stays on screen, clearable, as long as it narrows.
   */
  const showPeople = people.length > 1;

  /**
   * The three questions and a date: who (an account), resource (the `type`
   * column) and what (the `action` column), each one indexed column behind
   * the `(scopeType, scopeId)` prefix. No search box, and every filter
   * optional.
   */
  const filterFields = {
    /**
     * One person at a time, deliberately. A person picker answering "what
     * did SHE change" is a different question from "which kinds of thing
     * moved", and a list of two people is a report nobody asks for.
     */
    userId: {
      schema: z.string(),
      label: tr("activity.col.who"),
      icon: User,
      items: people.map((person) => ({
        label: person.label,
        value: person.id,
      })),
      hidden: !showPeople,
      control: { clearLabel: tr("activity.filter.allPeople") },
    },
    /**
     * ARRAYS, and empty means every value (feedback #2092). Both are the
     * multi-select case: "quests and epics" and "created or deleted" are
     * questions a reader has, and a single value could not express either.
     */
    type: {
      schema: z.array(z.string()),
      label: tr("activity.col.resource"),
      icon: Layers,
      mode: "default",
      items: options.types.map((type) => {
        const Icon = activityResourceIcon(type);
        return {
          label: activityResourceLabel(tr, type),
          value: type,
          icon: <Icon className="text-muted-foreground size-4" />,
        };
      }),
      control: {
        clearLabel: tr("activity.filter.allResources"),
      },
    },
    action: {
      schema: z.array(z.string()),
      label: tr("activity.col.what"),
      icon: Zap,
      // The label is capitalized, the value is not: this filter sits beside
      // the resource one, whose entries are all labels, and `create` between
      // `Epic` and `Quest` reads as a leaked column value. `value` stays the
      // stored verb, which is what the query filters on.
      // Narrowed to the actions the picked resource types declare, so
      // "Epic" does not offer "Rotate". Every action while no type is picked.
      // An action already picked stays listed even when the types move away
      // from it, so the control can still show and clear it.
      items: (values) => {
        const types = (values.type as string[] | undefined) ?? [];
        const picked = (values.action as string[] | undefined) ?? [];
        const possible =
          types.length === 0
            ? options.actions
            : [
                ...new Set(
                  options.pairs
                    .filter((pair) => types.includes(pair.type))
                    .map((pair) => pair.action),
                ),
              ].sort();
        return [...new Set([...possible, ...picked])].map((action) => ({
          label: capitalize(action),
          value: action,
        }));
      },
      control: {
        clearLabel: tr("activity.filter.allActions"),
      },
    },
    /**
     * When, as a closed range of calendar days.
     *
     * `z.dateRange()` makes both ends mandatory, so an absent value is the
     * whole of "no filter" - there is no half-range to represent and no empty
     * end to strip on the way out. It round-trips through the URL as
     * `?createdAt=2026-01-01,2026-01-31`, comma-joined by the client and split
     * back by `coerceStrings` on the server.
     */
    createdAt: {
      schema: z.dateRange(),
      label: tr("activity.col.when"),
      placeholder: tr("activity.filter.anyDate"),
    },
  } satisfies DataTableFilterFields;

  const fetchActivity = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: DataTableFilterValues<typeof filterFields>;
  }): Promise<Page<ProjectActivityRow>> => {
    if (!project) {
      return emptyPage(page, size);
    }
    // `""` is what a cleared Control sends, and it is not a filter: sent
    // through, it would select the rows whose column is the empty string,
    // which is none of them.
    const userId = filters?.userId || undefined;
    return await projectApi.getProjectActivity({
      params: { id: project.id },
      query: {
        page,
        size,
        sort,
        userId,
        // Comma-joined, which `AuditService.find` splits back into one
        // condition. A single value still produces the `eq` it always did.
        type: filters?.type?.length ? filters.type.join(",") : undefined,
        action: filters?.action?.length ? filters.action.join(",") : undefined,
        resourceType: resource?.type,
        resourceId: resource?.id,
        // Passed as the pair, not as two params: the endpoint resolves the
        // days to an instant window (`ProjectController.activityWindow`), so
        // the UI names a range and the server decides what a day means.
        createdAt:
          filters?.createdAt?.length === 2 ? filters.createdAt : undefined,
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
    // ⚠️ `p-2` flat, with nothing responsive. This page was once the only
    // table page whose padding scaled with the viewport (`p-4 md:p-6`), so
    // above `md` it sat 8px further from the edge than Epics, Releases,
    // Blights and Apps, which is what made it read as random rather than as a
    // rule (feedback #2099). The shared value then went from `p-4` to `p-2`
    // with #Q2266: change it everywhere or nowhere.
    // ⚠️ "Everywhere" is the TABLE pages, and only those: Epics, Releases,
    // Blights, Apps, Artifacts, Inbox, the epic's quests, and the admin
    // console's lists. #Q2266 took it to every project page and the card
    // pages lost their gutter, which #Q2291 undid. A page whose body is
    // cards, a form or prose stays at `p-4`.
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <DataTable<ProjectActivityRow, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey={persistenceKey ?? `lor.activity.${project.id}`}
        // Newest first, which is the question somebody opening this page is
        // asking. The column is sortable, so the other direction is one click.
        defaultSort={{ field: "createdAt", direction: "desc" }}
        emptyMessage={tr("activity.empty")}
        fetch={fetchActivity}
        filters={{ fields: filterFields }}
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
                <TimeAgo value={row.createdAt} />
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
                `${activityResourceLabel(tr, row.type)} ${row.resourceId ?? ""}`.trim();
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
            cell: (row) => <ActivityDetails metadata={row.metadata} />,
          },
        }}
      />
    </div>
  );
};

export default ProjectActivityPage;

/**
 * The shape `DataTable` expects when there is nothing to fetch yet.
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
