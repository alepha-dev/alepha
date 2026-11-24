import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableStatCard,
} from "@alepha/ui/table";
import {
  canInProject,
  capabilityOption,
  currentProjectAtom,
  formatReference,
  type I18n,
} from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  BookOpen,
  ChevronsUp,
  CircleDot,
  ClipboardCheck,
  Download,
  FileInput,
  Flag,
  Grid3x3,
  Layers,
  List,
  Plus,
  Shapes,
} from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementCoverageController } from "../../../../api/controllers/RequirementCoverageController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import {
  readinessOf,
  requirementsOfRelease,
} from "../../../../api/requirementReadiness.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { RequirementCoverage } from "../../../../api/schemas/requirementCoverageSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import RequirementDetail from "../requirements/RequirementDetail.tsx";
import {
  REQUIREMENT_PRIORITY_LABEL_KEYS,
  REQUIREMENT_STATUS_LABEL_KEYS,
  REQUIREMENT_TYPE_LABEL_KEYS,
} from "../requirements/requirementLabels.ts";
import RequirementPriorityBadge from "../requirements/RequirementPriorityBadge.tsx";
import RequirementSheet from "../requirements/RequirementSheet.tsx";
import RequirementStatusChips from "../requirements/RequirementStatusChips.tsx";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import RequirementsHover from "../shared/RequirementsHover.tsx";
import WarningNotice from "../shared/WarningNotice.tsx";
import CoverageGaps from "../traceability/CoverageGaps.tsx";
import ImpactChain from "../traceability/ImpactChain.tsx";
import ReadinessBanner from "../traceability/ReadinessBanner.tsx";
import TraceabilityMatrix from "../traceability/TraceabilityMatrix.tsx";
import VerifyDialog from "../verify/VerifyDialog.tsx";

/**
 * The Requirements page (#E153). The List view is a table of every
 * requirement on one page (the whole list is loaded anyway, for the counts
 * and the matrix), with status counters that filter, search, status, type,
 * priority, verification and release filters, and groups that fold: by
 * chapter (the default), priority, status or type. A row opens the detail
 * pane (`?requirement=15`).
 *
 * Above it, a banner naming the requirements whose source changed, and a
 * release's readiness while a release is filtered. The Matrix view draws
 * the traceability matrix of the rows the table's filters keep, with the
 * selected requirement's impact chain and the coverage gaps in the pane
 * (#Q3774).
 */
const RequirementsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const queries = useQueryClient();
  // This package's own page, named by string.
  const router = useRouter<any>();
  const routerState = useRouterState();
  const projectId = project?.id ?? 0;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<"list" | "matrix">("list");
  // The table's filter values, which the matrix and the readiness banner
  // read too (`filters.onChange`).
  const [values, setValues] = useState<RequirementFilterValues>({});
  const selected = Number(
    (routerState.query as Record<string, string> | undefined)?.requirement ?? 0,
  );

  const list = useQuery<RequirementResource[]>(
    {
      key: ["requirements", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirements({ params: { projectId }, query: {} }),
    },
    [api, projectId],
  );
  const releases = useQuery<
    Array<{ id: number; tag?: string; title?: string }>
  >(
    {
      key: ["requirements-releases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirementReleases({ params: { projectId } }),
    },
    [api, projectId],
  );

  const grouping = useForm({
    id: "requirement-grouping",
    schema: z.object({
      group: z.enum(["chapter", "priority", "status", "type", "none"]),
    }),
    initialValues: { group: "chapter" as const },
    handler: async () => {},
  });
  const group = useFormValues(grouping).group ?? "chapter";

  const matrix = view === "matrix";
  const releaseId = values.release ? Number(values.release) : undefined;
  const useCaseApi = useClient<UseCaseController>();
  const personaApi = useClient<PersonaController>();
  const coverageApi = useClient<RequirementCoverageController>();
  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled: projectId > 0 && matrix,
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId, matrix],
  );
  const personas = useQuery<PersonaResource[]>(
    {
      key: ["personas", projectId],
      enabled: projectId > 0 && matrix,
      handler: async () =>
        await personaApi.getPersonas({ params: { projectId }, query: {} }),
    },
    [personaApi, projectId, matrix],
  );
  const coverage = useQuery<RequirementCoverage>(
    {
      key: ["requirement-coverage", projectId, releaseId ?? 0],
      enabled: projectId > 0 && matrix,
      handler: async () =>
        await coverageApi.getRequirementCoverage({
          params: { projectId },
          query: releaseId ? { releaseId } : {},
        }),
    },
    [coverageApi, projectId, matrix, releaseId],
  );

  if (!project) return null;
  const all = list.data ?? [];
  const changed = all.filter((it) => it.sourceChanged);
  const current = all.find((it) => it.number === selected);
  const canWrite = canInProject(project, "requirement:write");
  const select = (number?: number) =>
    void router.push("projectRequirements", {
      params: { projectSlug: project.slug },
      query: number ? { requirement: String(number) } : {},
    });
  // The pane reads the list's row, so a write refreshes the list.
  const refresh = (_next?: RequirementResource) => {
    queries.invalidate(["requirements", projectId]);
  };

  const fields = {
    search: { preset: "search" },
    status: {
      schema: z.array(z.string()),
      label: tr("requirements.requirement.col.status"),
      icon: CircleDot,
      items: STATUSES.map((value) => ({
        value,
        label: tr(REQUIREMENT_STATUS_LABEL_KEYS[value]),
      })),
    },
    type: {
      schema: z.array(z.string()),
      label: tr("requirements.requirement.field.type"),
      icon: Shapes,
      mode: "default",
      items: TYPES.map((value) => ({
        value,
        label: tr(REQUIREMENT_TYPE_LABEL_KEYS[value]),
      })),
      control: { clearLabel: tr("requirements.requirement.filter.anyType") },
    },
    priority: {
      schema: z.array(z.string()),
      label: tr("requirements.requirement.field.priority"),
      icon: ChevronsUp,
      mode: "default",
      items: PRIORITIES.map((value) => ({
        value,
        label: tr(REQUIREMENT_PRIORITY_LABEL_KEYS[value]),
      })),
      control: {
        clearLabel: tr("requirements.requirement.filter.anyPriority"),
      },
    },
    verifiedBy: {
      schema: z.enum(["usecases", "metric", "none"]),
      label: tr("requirements.requirement.verifiedByFilter"),
      icon: ClipboardCheck,
      items: [
        {
          value: "usecases",
          label: tr("requirements.requirement.filter.useCases"),
        },
        {
          value: "metric",
          label: tr("requirements.requirement.filter.metric"),
        },
        { value: "none", label: tr("requirements.requirement.filter.nothing") },
      ],
      control: {
        clearLabel: tr("requirements.requirement.filter.anyVerification"),
      },
    },
    release: {
      schema: z.string(),
      label: tr("requirements.requirement.release"),
      icon: Flag,
      mode: "default",
      items: (releases.data ?? []).map((r) => ({
        value: String(r.id),
        label: r.tag ?? r.title ?? "",
      })),
      control: {
        clearLabel: tr("requirements.requirement.filter.allReleases"),
      },
    },
  } satisfies DataTableFilterFields;

  // Counters that are also quick filters, one per status.
  const cards: DataTableStatCard[] = [
    {
      label: tr(
        all.length === 1
          ? "requirements.requirement.counter.all.one"
          : "requirements.requirement.counter.all",
      ),
      value: String(all.length),
      // The way back to every requirement from the status counters (#Q3974).
      filter: { status: undefined },
    },
    ...STATUSES.map((status) => {
      const count = all.filter((row) => row.status === status).length;
      return {
        label: tr(REQUIREMENT_STATUS_LABEL_KEYS[status]),
        value: String(count),
        tone:
          status === "verified"
            ? ("success" as const)
            : status === "failing" && count > 0
              ? ("danger" as const)
              : status === "not_covered" && count > 0
                ? ("warning" as const)
                : undefined,
        filter: { status: [status] },
      };
    }),
  ];

  const groupKey = (row: RequirementResource): string =>
    group === "chapter"
      ? (row.chapter ?? "")
      : group === "priority"
        ? row.priority
        : group === "status"
          ? row.status
          : row.type;
  const groupLabel = (key: string): string =>
    group === "chapter"
      ? key || tr("requirements.requirement.noChapter")
      : group === "priority"
        ? tr(REQUIREMENT_PRIORITY_LABEL_KEYS[key as Priority])
        : group === "status"
          ? tr(REQUIREMENT_STATUS_LABEL_KEYS[key as Status])
          : tr(REQUIREMENT_TYPE_LABEL_KEYS[key as Type]);
  const groupOrder = (a: string, b: string): number => {
    if (group === "chapter") {
      // Chapters as written ("2. Field", "10. Integrations"), numbers
      // compared as numbers, and no chapter last.
      if (!a || !b) return a ? -1 : b ? 1 : 0;
      return a.localeCompare(b, undefined, { numeric: true });
    }
    const order: readonly string[] =
      group === "priority" ? PRIORITIES : group === "status" ? STATUSES : TYPES;
    return order.indexOf(a) - order.indexOf(b);
  };

  // Whichever tab is open: exports and the import, small, at the end of
  // the plate's tab band.
  const pageActions = [
    {
      icon: BookOpen,
      label: tr("requirements.trace.export.testBook"),
      onClick: () =>
        void router.push("projectRequirementsTestBook", {
          params: { projectSlug: project.slug },
        }),
    },
    {
      icon: Download,
      label: tr("requirements.trace.export.csv"),
      onClick: () => {
        window.location.assign(
          `/api/projects/${projectId}/requirements/export${releaseId ? `?releaseId=${releaseId}` : ""}`,
        );
      },
    },
    ...(canWrite
      ? [
          {
            icon: FileInput,
            label: tr("requirements.requirement.import"),
            onClick: () => setImporting(true),
          },
        ]
      : []),
  ];
  // The page's main action, in the List's toolbar; the Matrix has none.
  const create = canWrite
    ? [
        {
          icon: Plus,
          label: tr("project.menu.create-requirement"),
          primary: true,
          onClick: () => setCreating(true),
        },
      ]
    : [];

  // List and Matrix are the plate's two tabs, with no plate above them:
  // the breadcrumb names the page.
  const tabs: PlateTab[] = [
    {
      key: "list",
      label: tr("requirements.requirement.view.list"),
      icon: List,
    },
    {
      key: "matrix",
      label: tr("requirements.requirement.view.matrix"),
      icon: Grid3x3,
    },
  ];

  return (
    <RequirementsHover className="flex min-h-0 min-w-0 flex-1">
      <PlateLayout
        tabs={tabs}
        active={view}
        onSelect={(key) => setView(key as "list" | "matrix")}
        tabsTestId="requirements-views"
        tabsActions={
          <>
            {pageActions.map((it) => (
              <Button
                key={it.label}
                variant="minimal"
                size="sm"
                onClick={it.onClick}
              >
                <it.icon className="size-3.5" />
                {it.label}
              </Button>
            ))}
          </>
        }
        scroll={false}
        className="min-w-0 flex-1"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
          {changed.length ? (
            <WarningNotice data-testid="source-changed-banner">
              {tr("requirements.requirement.banner", {
                args: [
                  changed
                    .map((it) => formatReference("requirement", it.number))
                    .join(", "),
                ],
              })}
            </WarningNotice>
          ) : null}
          {releaseId ? (
            <ReadinessBanner
              release={
                releases.data?.find((it) => it.id === releaseId)?.tag ??
                values.release ??
                ""
              }
              readiness={readinessOf(requirementsOfRelease(all, releaseId))}
              blocks={
                capabilityOption(project, "plan", "blockFailingMust") === true
              }
            />
          ) : null}
          {matrix ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border p-4">
                <TraceabilityMatrix
                  requirements={all.filter((row) => matches(row, values))}
                  useCases={useCases.data ?? []}
                  personas={personas.data ?? []}
                  selected={selected || undefined}
                  onSelect={(number) => select(number)}
                />
              </div>
            </div>
          ) : (
            <div
              className="flex min-h-0 flex-1 flex-col"
              data-testid="requirements-table"
            >
              <DataTable<RequirementResource, typeof fields>
                key={project.id}
                className="min-h-0 flex-1"
                persistenceKey={`lore.requirements.${project.id}`}
                data={all}
                pagination={false}
                rowKey={(row) => String(row.id)}
                filters={{
                  fields,
                  onChange: (next) =>
                    setValues(next as RequirementFilterValues),
                }}
                filter={(row, next) => matches(row, next)}
                summary={{ cards }}
                groupBy={
                  group === "none"
                    ? undefined
                    : { key: groupKey, label: groupLabel, order: groupOrder }
                }
                defaultSort={{ field: "requirement", direction: "asc" }}
                onRowClick={(row) => select(row.number)}
                actions={create}
                // The requirement the detail pane shows.
                isRowActive={(row) => row.number === selected}
                emptyState={{ title: tr("requirements.requirement.empty") }}
                noMatchState={{
                  title: tr("requirements.requirement.emptyFilter"),
                }}
                toolbar={
                  <div className="flex items-center gap-2">
                    <div className="w-40">
                      <Control
                        input={grouping.input.group}
                        label=""
                        select
                        icon={Layers}
                        aria-label={tr("requirements.usecase.groupBy")}
                        items={GROUPINGS.map((it) => ({
                          value: it,
                          label: tr(GROUPING_LABEL_KEYS[it]),
                        }))}
                      />
                    </div>
                  </div>
                }
                columns={{
                  requirement: {
                    label: tr("requirements.requirement.col.requirement"),
                    sortable: true,
                    sortValue: (row) => row.number,
                    className: "whitespace-normal",
                    cell: (row) => (
                      <span data-testid="requirement-row">
                        <span className="font-semibold">
                          {formatReference("requirement", row.number)}
                        </span>{" "}
                        {row.statement}
                        {row.paragraph ? (
                          <span className="text-muted-foreground text-xs">
                            {" "}
                            §{row.paragraph}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  type: {
                    label: tr("requirements.requirement.field.type"),
                    sortable: true,
                    sortValue: (row) => TYPES.indexOf(row.type),
                    cell: (row) => tr(REQUIREMENT_TYPE_LABEL_KEYS[row.type]),
                  },
                  priority: {
                    label: tr("requirements.requirement.field.priority"),
                    sortable: true,
                    // Must first, Won't last: by rank, not alphabetically.
                    sortValue: (row) => PRIORITIES.indexOf(row.priority),
                    cell: (row) => (
                      <RequirementPriorityBadge priority={row.priority} />
                    ),
                  },
                  release: {
                    label: tr("requirements.requirement.release"),
                    sortable: true,
                    sortValue: (row) =>
                      row.targetRelease?.tag ?? row.targetRelease?.title,
                    cell: (row) =>
                      row.targetRelease ? (
                        <span>
                          {row.targetRelease.tag ?? row.targetRelease.title}{" "}
                          <span className="text-muted-foreground text-xs">
                            {tr(
                              row.targetRelease.mode === "auto"
                                ? "requirements.requirement.release.autoShort"
                                : "requirements.requirement.release.byHandShort",
                            )}
                          </span>
                        </span>
                      ) : (
                        "-"
                      ),
                  },
                  verifiedBy: {
                    label: tr("requirements.requirement.col.verifiedBy"),
                    cell: (row) =>
                      row.metric ? (
                        tr("requirements.requirement.metric")
                      ) : row.criteria.length ? (
                        // `ReferenceLink` stops its click, so it opens the use
                        // case and not the row's detail pane.
                        <span className="flex flex-wrap gap-x-2 text-xs">
                          {row.criteria.map((c) => (
                            <ReferenceLink
                              key={`${c.useCaseNumber}:${c.key}`}
                              kind="usecase"
                              number={c.useCaseNumber}
                            >
                              {c.key}
                            </ReferenceLink>
                          ))}
                        </span>
                      ) : (
                        "-"
                      ),
                  },
                  status: {
                    label: tr("requirements.requirement.col.status"),
                    sortable: true,
                    // Verified first, no data last.
                    sortValue: (row) => STATUSES.indexOf(row.status),
                    cell: (row) => <RequirementStatusChips requirement={row} />,
                  },
                }}
              />
            </div>
          )}
        </div>
      </PlateLayout>
      {matrix ? (
        <aside
          className="chrome flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l p-3"
          data-testid="traceability-pane"
        >
          {current ? (
            <ImpactChain projectId={projectId} requirement={current} />
          ) : null}
          {coverage.data ? (
            <CoverageGaps
              projectId={projectId}
              canWrite={canWrite}
              coverage={coverage.data}
            />
          ) : null}
        </aside>
      ) : current ? (
        // Slides in from the end as it opens; switching to another
        // requirement keeps the pane mounted, so it does not replay.
        <aside className="animate-in fade-in-0 slide-in-from-end-8 w-96 shrink-0 overflow-y-auto border-l duration-200 motion-reduce:animate-none">
          <RequirementDetail
            key={current.id}
            requirement={current}
            releases={releases.data ?? []}
            onChange={(next) => refresh(next)}
            onEdit={() => setEditing(true)}
            onClose={() => select(undefined)}
            onDeleted={() => {
              select(undefined);
              refresh();
            }}
          />
        </aside>
      ) : null}
      <VerifyDialog
        subject={{ kind: "import" }}
        open={importing}
        onOpenChange={setImporting}
      />
      <RequirementSheet
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSubmit={(saved) => {
          setCreating(false);
          refresh();
          select(saved.number);
        }}
      />
      {current ? (
        <RequirementSheet
          key={`edit-${current.id}`}
          projectId={projectId}
          requirement={current}
          open={editing}
          onOpenChange={setEditing}
          onSubmit={(saved) => {
            setEditing(false);
            refresh(saved);
          }}
        />
      ) : null}
    </RequirementsHover>
  );
};

export default RequirementsPage;

const TYPES = ["functional", "non_functional", "constraint"] as const;
const PRIORITIES = ["must", "should", "could", "wont"] as const;
const STATUSES = [
  "verified",
  "failing",
  "in_development",
  "covered",
  "not_covered",
  "no_data",
] as const;
type Type = (typeof TYPES)[number];
type Priority = (typeof PRIORITIES)[number];
type Status = (typeof STATUSES)[number];

const GROUPINGS = ["chapter", "priority", "status", "type", "none"] as const;

const GROUPING_LABEL_KEYS = {
  chapter: "requirements.requirement.groupBy.chapter",
  priority: "requirements.requirement.field.priority",
  status: "requirements.requirement.col.status",
  type: "requirements.requirement.field.type",
  none: "requirements.usecase.groupBy.none",
} as const;

interface RequirementFilterValues {
  search?: string;
  status?: string[];
  type?: string[];
  priority?: string[];
  verifiedBy?: "usecases" | "metric" | "none";
  release?: string;
}

/**
 * The table's filter, which replaces the static mode's field matching:
 * the search spans the reference, the statement and the chapter, and the
 * verification and the release are read from the row's nested fields.
 */
const matches = (
  row: RequirementResource,
  values: RequirementFilterValues,
): boolean => {
  const search = values.search?.trim().toLowerCase();
  if (
    search &&
    !`${formatReference("requirement", row.number)} ${row.statement} ${row.chapter ?? ""}`
      .toLowerCase()
      .includes(search)
  ) {
    return false;
  }
  if (values.status?.length && !values.status.includes(row.status)) {
    return false;
  }
  if (values.type?.length && !values.type.includes(row.type)) return false;
  if (values.priority?.length && !values.priority.includes(row.priority)) {
    return false;
  }
  if (values.verifiedBy) {
    const verified =
      values.verifiedBy === "usecases"
        ? row.criteria.length > 0
        : values.verifiedBy === "metric"
          ? !!row.metric
          : row.criteria.length === 0 && !row.metric;
    if (!verified) return false;
  }
  if (
    values.release &&
    String(row.targetRelease?.id ?? "") !== values.release
  ) {
    return false;
  }
  return true;
};
