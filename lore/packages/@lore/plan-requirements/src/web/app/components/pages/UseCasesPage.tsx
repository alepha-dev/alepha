import { Progress } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableStatCard,
} from "@alepha/ui/table";
import {
  canInProject,
  currentProjectAtom,
  formatReference,
  type I18n,
  PinnedPromptsButton,
} from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  CircleDot,
  ClipboardCheck,
  Layers,
  ListChecks,
  Plus,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { useCaseGroupingAtom } from "../../atoms/useCaseGroupingAtom.ts";
import ActorAvatars from "../usecases/ActorAvatars.tsx";
import { developmentKey } from "../usecases/developmentKey.ts";
import {
  developmentOf,
  groupUseCases,
  type UseCaseGroup,
  type UseCaseGrouping,
} from "../usecases/groupUseCases.ts";
import RunStateBadge from "../usecases/RunStateBadge.tsx";
import { USE_CASE_STATUS_LABEL_KEYS } from "../usecases/useCaseLabels.ts";
import UseCaseSheet from "../usecases/UseCaseSheet.tsx";
import UseCaseStatusBadge from "../usecases/UseCaseStatusBadge.tsx";
import VerifyDialog from "../verify/VerifyDialog.tsx";

/**
 * The Use cases page (#E153): every use case of the project in one table,
 * with counters that filter, search, persona, status and run filters, and
 * groups that fold: by persona (the default since #Q3979), covering epic,
 * status, or none, the reader's last pick kept per project.
 *
 * The whole list is loaded (the counters and the persona cards count it), and the table pages it, 50 rows at a time (#Q3978): drawing all
 * 276 rows of a large project is what made the page lag. The table groups the
 * whole filtered set before it pages, so a page holds the next rows group by
 * group and each group header counts the group over every page.
 *
 * A use case covered by two epics, or played by two personas, shows in each
 * of their groups: the table is handed one row per group and use case, and
 * the counters count use cases, once each.
 */
const UseCasesPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  const queries = useQueryClient();
  // Pages of this package, named by string.
  const router = useRouter<any>();
  const projectId = project?.id ?? 0;
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId],
  );

  // The grouping, outside the table's filters: it arranges the rows and
  // narrows none of them. By persona on a first visit, then the reader's
  // last pick for this project (#Q3979).
  const [remembered, setRemembered] = useStore(useCaseGroupingAtom);
  const grouping = useForm({
    id: "use-case-grouping",
    schema: z.object({
      group: z.enum(["epic", "persona", "status", "none"]).optional(),
    }),
    initialValues: {
      group: remembered.byProject[String(projectId)] ?? ("persona" as const),
    },
    onChange: (_key, next) => {
      if (!next) return;
      setRemembered({
        byProject: {
          ...remembered.byProject,
          [String(projectId)]: next as UseCaseGrouping,
        },
      });
    },
    handler: async () => {},
  });
  const group = (useFormValues(grouping).group ?? "persona") as UseCaseGrouping;

  const all = useMemo(() => useCases.data ?? [], [useCases.data]);
  const groups = useMemo(() => groupUseCases(all, group), [all, group]);
  const rows = useMemo<UseCaseRow[]>(
    () =>
      groups.flatMap((it) => it.rows.map((row) => ({ ...row, group: it.key }))),
    [groups],
  );

  if (!project) return null;

  const byKey = new Map(groups.map((it, index) => [it.key, { it, index }]));
  const personas = [
    ...new Map(
      all.flatMap((it) => it.actors).map((a) => [a.number, a]),
    ).values(),
  ].sort((a, b) => a.number - b.number);
  const canWrite = canInProject(project, "usecase:write");
  const staleCount = all.filter((row) => row.stale).length;

  const fields = {
    search: { preset: "search" },
    state: {
      schema: z.array(z.string()),
      label: tr("requirements.run.lastResult"),
      icon: ListChecks,
      mode: "default",
      items: RUN_STATES.map((value) => ({
        value,
        label: tr(RUN_STATE_LABEL_KEYS[value]),
      })),
      control: { clearLabel: tr("requirements.usecase.filter.anyResult") },
    },
    status: {
      schema: z.array(z.string()),
      label: tr("requirements.usecase.filter.status"),
      icon: CircleDot,
      mode: "default",
      items: STATUSES.map((value) => ({
        value,
        label: tr(USE_CASE_STATUS_LABEL_KEYS[value]),
      })),
      control: { clearLabel: tr("requirements.usecase.filter.anyStatus") },
    },
    persona: {
      schema: z.string(),
      label: tr("requirements.usecase.filter.persona"),
      icon: UsersRound,
      mode: "default",
      items: personas.map((p) => ({
        value: String(p.number),
        label: `${formatReference("persona", p.number)} ${p.name}`,
      })),
      control: { clearLabel: tr("requirements.usecase.filter.anyPersona") },
    },
    stale: {
      schema: z.boolean(),
      label: tr("requirements.run.stale"),
      icon: ClipboardCheck,
    },
  } satisfies DataTableFilterFields;

  // Counters that are also quick filters: a click narrows the table to
  // them, a second click clears it.
  const cards: DataTableStatCard[] = [
    {
      label: tr(
        all.length === 1
          ? "requirements.usecase.counter.all.one"
          : "requirements.usecase.counter.all",
      ),
      value: String(all.length),
      // The way back to every use case from the result counters (#Q3974).
      filter: { state: undefined },
    },
    ...RUN_STATES.map((state) => {
      const count = all.filter((row) => row.state === state).length;
      return {
        label: tr(RUN_STATE_LABEL_KEYS[state]),
        value: String(count),
        tone:
          state === "failed" && count > 0
            ? ("danger" as const)
            : state === "passed"
              ? ("success" as const)
              : undefined,
        filter: { state: [state] },
      };
    }),
    {
      label: tr("requirements.run.stale"),
      value: String(staleCount),
      tone: staleCount > 0 ? ("warning" as const) : undefined,
      filter: { stale: true },
    },
  ];

  const groupLabel = (key: string) => {
    const entry = byKey.get(key)?.it;
    if (!entry) return key;
    const count = tr(
      entry.rows.length === 1
        ? "requirements.usecase.group.count.one"
        : "requirements.usecase.group.count",
      { args: [String(entry.rows.length)] },
    );
    return (
      <span className="flex items-center gap-2">
        <span>{groupTitle(entry, tr)}</span>
        {entry.progress ? (
          <span className="text-muted-foreground text-xs font-normal">
            {tr(developmentKey(entry.progress.total), {
              args: [
                String(entry.progress.completed),
                String(entry.progress.total),
              ],
            })}
          </span>
        ) : null}
        <span className="sr-only">{count}</span>
      </span>
    );
  };

  const hrefOf = (row: UseCaseResource) =>
    router.path("projectUseCase", {
      params: { projectSlug: project.slug, useCaseNumber: String(row.number) },
    });

  return (
    <div
      className="flex min-h-0 flex-1 flex-col p-2"
      data-testid="use-cases-table"
    >
      <DataTable<UseCaseRow, typeof fields>
        key={project.id}
        className="min-h-0 flex-1"
        persistenceKey={`lore.use-cases.${project.id}`}
        data={rows}
        defaultSize={50}
        rowKey={(row) => `${row.group}:${row.id}`}
        filters={{ fields }}
        filter={(row, values) => matches(row, values)}
        summary={{ cards }}
        groupBy={
          group === "none"
            ? undefined
            : {
                key: (row) => row.group,
                label: (key) => groupLabel(key),
                order: (a, b) =>
                  (byKey.get(a)?.index ?? 0) - (byKey.get(b)?.index ?? 0),
              }
        }
        defaultSort={{ field: "useCase", direction: "asc" }}
        onRowClick={(row) => void router.push(hrefOf(row))}
        emptyState={{ title: tr("requirements.usecase.empty") }}
        noMatchState={{ title: tr("requirements.usecase.emptyFilter") }}
        toolbar={
          <div className="flex items-center gap-2">
            {/* The prompts pinned on the Use case list (#Q4412). */}
            <PinnedPromptsButton page="use-cases" />
            <div className="w-44">
              <Control
                input={grouping.input.group}
                label=""
                select
                icon={Layers}
                aria-label={tr("requirements.usecase.groupBy")}
                items={(["epic", "persona", "status", "none"] as const).map(
                  (it) => ({ value: it, label: tr(GROUP_LABEL_KEYS[it]) }),
                )}
              />
            </div>
          </div>
        }
        actions={[
          {
            icon: ClipboardCheck,
            label: tr("requirements.verify.allStale", {
              args: [String(staleCount)],
            }),
            onClick: () => setVerifying(true),
          },
          ...(canWrite
            ? [
                {
                  icon: Plus,
                  label: tr("project.menu.create-usecase"),
                  primary: true,
                  onClick: () => setCreating(true),
                },
              ]
            : []),
        ]}
        columns={{
          useCase: {
            label: tr("requirements.usecase.col.useCase"),
            sortable: true,
            sortValue: (row) => row.number,
            cell: (row) => (
              <Link
                href={hrefOf(row)}
                className="hover:underline"
                data-testid="use-case-row"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="font-semibold">
                  {formatReference("usecase", row.number)}
                </span>{" "}
                {row.title}
              </Link>
            ),
          },
          actors: {
            label: tr("requirements.usecase.col.actors"),
            cell: (row) => <ActorAvatars actors={row.actors} />,
          },
          status: {
            label: tr("requirements.usecase.col.status"),
            sortable: true,
            // Draft to deprecated, the order a use case moves through.
            sortValue: (row) => STATUSES.indexOf(row.status),
            cell: (row) => <UseCaseStatusBadge status={row.status} />,
          },
          development: {
            label: tr("requirements.usecase.col.development"),
            cell: (row) => {
              const dev = developmentOf(row);
              return dev ? (
                <div className="flex items-center gap-2">
                  <Progress
                    className="w-20"
                    value={
                      dev.total
                        ? Math.round((dev.completed / dev.total) * 100)
                        : 0
                    }
                  />
                  <span className="text-muted-foreground text-xs">
                    {tr(developmentKey(dev.total), {
                      args: [String(dev.completed), String(dev.total)],
                    })}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("requirements.usecase.noEpic")}
                </span>
              );
            },
          },
          lastResult: {
            label: tr("requirements.run.lastResult"),
            sortable: true,
            sortValue: (row) => RUN_STATES.indexOf(row.state),
            cell: (row) => (
              <RunStateBadge state={row.state} stale={row.stale} />
            ),
          },
        }}
      />
      <VerifyDialog
        subject={{ kind: "allStale" }}
        open={verifying}
        onOpenChange={setVerifying}
      />
      <UseCaseSheet
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSubmit={() => {
          setCreating(false);
          queries.invalidate(["use-cases", projectId]);
        }}
      />
    </div>
  );
};

export default UseCasesPage;

/**
 * One row of the table: a use case in one of its groups.
 */
type UseCaseRow = UseCaseResource & { group: string };

const STATUSES = ["draft", "ready", "validated", "deprecated"] as const;

const RUN_STATES = ["passed", "failed", "in_development", "never_run"] as const;

const RUN_STATE_LABEL_KEYS = {
  passed: "requirements.run.state.passed",
  failed: "requirements.run.state.failed",
  in_development: "requirements.run.state.in_development",
  never_run: "requirements.run.state.never_run",
} as const;

const GROUP_LABEL_KEYS = {
  epic: "requirements.usecase.groupBy.epic",
  persona: "requirements.usecase.groupBy.persona",
  status: "requirements.usecase.groupBy.status",
  none: "requirements.usecase.groupBy.none",
} as const;

/**
 * A group's title: the epic or persona by reference and name, the status by
 * its label, or "No epic yet".
 */
const groupTitle = (
  group: UseCaseGroup,
  tr: (key: any, options?: any) => string,
): string =>
  group.kind === "epic"
    ? `${formatReference("epic", group.number ?? 0)} ${group.label}`
    : group.kind === "persona"
      ? `${formatReference("persona", group.number ?? 0)} ${group.label}`
      : group.kind === "status"
        ? tr(
            USE_CASE_STATUS_LABEL_KEYS[
              group.label as (typeof STATUSES)[number]
            ],
          )
        : tr("requirements.usecase.group.unplanned");

/**
 * The table's filter, which replaces the static mode's field matching: the
 * persona is matched among a row's actors and the search spans the
 * reference and the title.
 */
const matches = (
  row: UseCaseRow,
  values: {
    search?: string;
    state?: string[];
    status?: string[];
    persona?: string;
    stale?: boolean;
  },
): boolean => {
  const search = values.search?.trim().toLowerCase();
  if (
    search &&
    !`${formatReference("usecase", row.number)} ${row.title}`
      .toLowerCase()
      .includes(search)
  ) {
    return false;
  }
  if (values.state?.length && !values.state.includes(row.state)) return false;
  if (values.status?.length && !values.status.includes(row.status)) {
    return false;
  }
  if (
    values.persona &&
    !row.actors.some((actor) => String(actor.number) === values.persona)
  ) {
    return false;
  }
  if (values.stale && !row.stale) return false;
  return true;
};
