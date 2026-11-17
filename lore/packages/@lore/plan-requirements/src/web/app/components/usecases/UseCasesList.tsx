import { Button, Progress, useDialog } from "@alepha/ui";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import {
  canInProject,
  currentProjectAtom,
  formatReference,
  type I18n,
} from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  BookText,
  Bot,
  CircleDot,
  ClipboardCheck,
  Clock,
  Layers,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useState } from "react";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { useCaseRunStateSchema } from "../../../../api/schemas/useCaseRunStateSchema.ts";
import { useCaseStatusSchema } from "../../../../api/schemas/useCaseStatusSchema.ts";
import GuideLink from "../shared/GuideLink.tsx";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import VerifyDialog, { type VerifySubject } from "../verify/VerifyDialog.tsx";
import ActorAvatars from "./ActorAvatars.tsx";
import { developmentKey } from "./developmentKey.ts";
import { developmentOf } from "./developmentOf.ts";
import RunStateBadge from "./RunStateBadge.tsx";
import {
  RUN_STATE_ICONS,
  RUN_STATE_LABEL_KEYS,
  USE_CASE_STATUS_LABEL_KEYS,
} from "./useCaseLabels.ts";
import UseCasePriorityBadge from "./UseCasePriorityBadge.tsx";
import UseCaseSheet from "./UseCaseSheet.tsx";
import UseCaseStatusBadge from "./UseCaseStatusBadge.tsx";

export interface UseCasesListProps {
  useCases: UseCaseResource[];
}

/**
 * The Use cases list (#E153), on the table every other list of Lore is: a
 * search, filters that start empty (status, persona, epic, last result,
 * stale), a preset rail counting each last result, sortable columns, a row
 * menu, bulk delete, and its actions in the table's own toolbar (New use
 * case, Verify all stale). A row opens the use case's page.
 *
 * The epic covering a use case is a column to sort and filter on, where the
 * hand-drawn table grouped its rows.
 */
const UseCasesList = (props: UseCasesListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  const queries = useQueryClient();
  // Pages of this package, named by string.
  const router = useRouter<any>();
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState<VerifySubject>();
  const projectId = project?.id ?? 0;
  const all = props.useCases;

  const remove = useAction<[rows: UseCaseResource[]], boolean>(
    {
      handler: async (_ctx, rows) => {
        const ok = await dialog.confirm({
          title:
            rows.length === 1
              ? tr("requirements.usecase.delete.title")
              : tr("requirements.usecase.delete.title.many", {
                  args: [String(rows.length)],
                }),
          description:
            rows.length === 1
              ? tr("requirements.usecase.delete.description", {
                  args: [rows[0].title],
                })
              : undefined,
          confirmLabel: tr("requirements.usecase.delete.confirm"),
          destructive: true,
        });
        if (!ok) return false;
        await Promise.all(
          rows.map((row) =>
            useCaseApi.deleteUseCase({ params: { id: row.id } }),
          ),
        );
        return true;
      },
      invalidates: [["use-cases", projectId]],
    },
    [useCaseApi, dialog, tr, projectId],
  );

  if (!project) return null;
  const canWrite = canInProject(project, "usecase:write");
  const stale = all.filter((row) => row.stale).length;
  const pathOf = (row: UseCaseResource) => ({
    params: { projectSlug: project.slug, useCaseNumber: String(row.number) },
  });
  const personas = [
    ...new Map(
      all.flatMap((it) => it.actors).map((a) => [a.number, a]),
    ).values(),
  ].sort((a, b) => a.number - b.number);
  const epics = [
    ...new Map(
      all.flatMap((it) => it.coveredBy).map((e) => [e.number, e]),
    ).values(),
  ].sort((a, b) => a.number - b.number);

  const filterFields = {
    search: { preset: "search" },
    status: {
      schema: z.array(useCaseStatusSchema),
      label: tr("requirements.usecase.filter.status"),
      icon: CircleDot,
      mode: "default",
      optionLabel: (status: UseCaseResource["status"]) =>
        tr(USE_CASE_STATUS_LABEL_KEYS[status]),
      control: { clearLabel: tr("requirements.usecase.filter.anyStatus") },
    },
    // Persona and epic numbers as strings, as a release filter holds ids.
    persona: {
      schema: z.array(z.string()),
      label: tr("requirements.usecase.filter.persona"),
      icon: UsersRound,
      mode: "default",
      items: personas.map((p) => ({
        value: String(p.number),
        label: `${formatReference("persona", p.number)} ${p.name}`,
      })),
      hidden: personas.length === 0,
      control: { clearLabel: tr("requirements.usecase.filter.anyPersona") },
    },
    epic: {
      schema: z.array(z.string()),
      label: tr("requirements.usecase.col.epic"),
      icon: Layers,
      items: [
        { value: NO_EPIC, label: tr("requirements.usecase.group.unplanned") },
        ...epics.map((e) => ({
          value: String(e.number),
          label: `${formatReference("epic", e.number)} ${e.title}`,
        })),
      ],
      hidden: epics.length === 0,
      control: { clearLabel: tr("requirements.usecase.filter.anyEpic") },
    },
    state: {
      schema: z.array(useCaseRunStateSchema),
      label: tr("requirements.run.lastResult"),
      icon: ClipboardCheck,
      optionLabel: (state: UseCaseResource["state"]) =>
        tr(RUN_STATE_LABEL_KEYS[state]),
      control: { clearLabel: tr("requirements.usecase.filter.anyResult") },
    },
    // What the Stale preset sets: one value.
    stale: {
      schema: z.enum(["yes"]),
      label: tr("requirements.run.stale"),
      icon: Clock,
      optionLabel: () => tr("requirements.run.stale"),
    },
  } satisfies DataTableFilterFields;

  const matches = (
    row: UseCaseResource,
    filters: DataTableFilterValues<typeof filterFields>,
  ) => {
    const needle = (filters.search ?? "").trim().toLowerCase();
    return (
      (!needle ||
        `u${row.number} ${row.title} ${row.actors.map((a) => a.name).join(" ")}`
          .toLowerCase()
          .includes(needle)) &&
      (!filters.status?.length || filters.status.includes(row.status)) &&
      (!filters.persona?.length ||
        row.actors.some((a) => filters.persona?.includes(String(a.number)))) &&
      (!filters.epic?.length ||
        (row.coveredBy.length === 0
          ? filters.epic.includes(NO_EPIC)
          : row.coveredBy.some((e) =>
              filters.epic?.includes(String(e.number)),
            ))) &&
      (!filters.state?.length || filters.state.includes(row.state)) &&
      (!filters.stale || row.stale)
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <DataTable<UseCaseResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey={`lor.use-cases.${project.id}`}
        data={all}
        filter={matches}
        defaultSort={{ field: "number", direction: "asc" }}
        emptyState={{
          icon: BookText,
          title: tr("requirements.usecase.empty.title"),
          description: tr("requirements.usecase.empty"),
          action: (
            <div className="flex flex-col items-center gap-3">
              {canWrite ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  {tr("project.menu.create-usecase")}
                </Button>
              ) : null}
              <GuideLink guide="plan-use-cases" />
            </div>
          ),
        }}
        noMatchState={{ description: tr("requirements.usecase.emptyFilter") }}
        filters={{
          fields: filterFields,
          fromQuery: true,
          presets: {
            items: [
              ...useCaseRunStateSchema.options.map((state) => ({
                key: state,
                label: tr(RUN_STATE_LABEL_KEYS[state]),
                // The rail cuts a long label: the tooltip says it whole.
                hint: tr(RUN_STATE_LABEL_KEYS[state]),
                icon: RUN_STATE_ICONS[state],
                tone:
                  state === "failed"
                    ? ("danger" as const)
                    : ("default" as const),
                count: all.filter((row) => row.state === state).length,
                values: { state: [state] },
              })),
              {
                key: "stale",
                label: tr("requirements.run.stale"),
                hint: tr("requirements.run.stale.hint"),
                icon: Clock,
                group: "stale",
                count: stale,
                values: { stale: "yes" as const },
              },
            ],
            all: { label: tr("requirements.usecase.presets.all") },
          },
        }}
        actions={[
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
          {
            // The robot glyph every agent prompt in Lore sits behind.
            icon: Bot,
            label: tr("requirements.verify.allStale", {
              args: [String(stale)],
            }),
            onClick: () => setVerifying({ kind: "allStale" }),
          },
        ]}
        onRowHover={(row) => {
          if (row) router.prefetch("projectUseCase", pathOf(row));
        }}
        onRowClick={(row) => void router.push("projectUseCase", pathOf(row))}
        rowActions={(row) => [
          {
            icon: Bot,
            label: tr("requirements.verify"),
            onClick: () =>
              setVerifying({ kind: "usecase", number: row.number }),
          },
          ...(canWrite
            ? [
                {
                  icon: Trash2,
                  label: tr("requirements.persona.delete"),
                  destructive: true,
                  disabled: () => remove.loading,
                  onClick: async (
                    item: UseCaseResource,
                    ctx: { clearSelection: () => void },
                  ) => {
                    const result = await remove.run([item]);
                    if (result.ok && result.value) ctx.clearSelection();
                  },
                },
              ]
            : []),
        ]}
        bulkActions={
          canWrite
            ? [
                {
                  icon: Trash2,
                  label: tr("requirements.persona.delete"),
                  destructive: true,
                  visible: () => !remove.loading,
                  onClick: async (rows, ctx) => {
                    const result = await remove.run(rows);
                    if (result.ok && result.value) ctx.clearSelection();
                  },
                },
              ]
            : undefined
        }
        columns={{
          number: {
            label: tr("requirements.usecase.col.useCase"),
            sortable: true,
            className: "w-full max-w-0 min-w-48",
            cell: (row) => (
              <div
                className="overflow-hidden text-ellipsis whitespace-nowrap"
                title={row.title}
                data-testid="use-case-row"
              >
                <ReferenceLink kind="usecase" number={row.number}>
                  {row.title}
                </ReferenceLink>
              </div>
            ),
          },
          actors: {
            label: tr("requirements.usecase.col.actors"),
            cell: (row) =>
              row.actors.length ? (
                <ActorAvatars actors={row.actors} />
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          epic: {
            label: tr("requirements.usecase.col.epic"),
            sortable: true,
            // Uncovered use cases last, whichever way the column sorts up.
            sortValue: (row) =>
              row.coveredBy[0]?.number ?? Number.MAX_SAFE_INTEGER,
            className: "whitespace-nowrap",
            cell: (row) =>
              row.coveredBy.length ? (
                <span className="flex flex-wrap gap-x-2 text-sm">
                  {row.coveredBy.map((epic) => (
                    <span key={epic.id} title={epic.title}>
                      <ReferenceLink kind="epic" number={epic.number} />
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("requirements.usecase.noEpic")}
                </span>
              ),
          },
          status: {
            label: tr("requirements.usecase.col.status"),
            sortable: true,
            cell: (row) => <UseCaseStatusBadge status={row.status} />,
          },
          priority: {
            label: tr("requirements.usecase.field.priority"),
            sortable: true,
            sortValue: (row) => PRIORITY_RANK[row.priority],
            defaultHidden: true,
            cell: (row) => <UseCasePriorityBadge priority={row.priority} />,
          },
          development: {
            label: tr("requirements.usecase.col.development"),
            className: "whitespace-nowrap",
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
                <span className="text-muted-foreground">-</span>
              );
            },
          },
          state: {
            label: tr("requirements.run.lastResult"),
            sortable: true,
            cell: (row) => (
              <RunStateBadge state={row.state} stale={row.stale} />
            ),
          },
        }}
      />
      {verifying ? (
        <VerifyDialog
          subject={verifying}
          open
          onOpenChange={(open) => {
            if (!open) setVerifying(undefined);
          }}
        />
      ) : null}
      <UseCaseSheet
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSubmit={(saved) => {
          setCreating(false);
          queries.invalidate(["use-cases", projectId]);
          void router.push("projectUseCase", pathOf(saved));
        }}
      />
    </div>
  );
};

export default UseCasesList;

/**
 * The epic filter's "no epic yet" value, beside the epic numbers.
 */
const NO_EPIC = "none";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
