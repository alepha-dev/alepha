import { Button, useDialog } from "@alepha/ui";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import {
  canInProject,
  capabilityOption,
  currentProjectAtom,
  type I18n,
} from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  BookOpen,
  CircleDot,
  ClipboardCheck,
  Download,
  FileInput,
  FileWarning,
  Flag,
  ListChecks,
  Pencil,
  Plus,
  Shapes,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import {
  readinessOf,
  requirementsOfRelease,
} from "../../../../api/requirementReadiness.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import { requirementStatusSchema } from "../../../../api/schemas/requirementStatusSchema.ts";
import { requirementTypeSchema } from "../../../../api/schemas/requirementTypeSchema.ts";
import GuideLink from "../shared/GuideLink.tsx";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import ReadinessBanner from "../traceability/ReadinessBanner.tsx";
import VerifyDialog from "../verify/VerifyDialog.tsx";
import {
  REQUIREMENT_STATUS_ICONS,
  REQUIREMENT_STATUS_LABEL_KEYS,
  REQUIREMENT_TYPE_LABEL_KEYS,
} from "./requirementLabels.ts";
import RequirementPriorityBadge from "./RequirementPriorityBadge.tsx";
import RequirementSheet from "./RequirementSheet.tsx";
import RequirementStatusChips from "./RequirementStatusChips.tsx";
import RequirementsViewSwitch from "./RequirementsViewSwitch.tsx";

export interface RequirementsListProps {
  requirements: RequirementResource[];
  releases: Array<{ id: number; tag?: string; title?: string }>;
}

/**
 * The Requirements list (#E153), on the table every other list of Lore is:
 * a search, filters that start empty (status, type, verified by, release,
 * source changed), a preset rail counting each status, sortable columns, a
 * row menu, bulk delete, and its actions in the table's own toolbar (New
 * requirement, Import, Test book, CSV). A row opens the requirement's page.
 * Filtering on one release draws its readiness in the summary band.
 *
 * Static rows: the tab's count and the matrix read the same list.
 */
const RequirementsList = (props: RequirementsListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const queries = useQueryClient();
  // Pages of this package, named by string.
  const router = useRouter<any>();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<RequirementResource>();
  const [releaseFilter, setReleaseFilter] = useState<string[]>([]);
  const projectId = project?.id ?? 0;
  const all = props.requirements;

  const remove = useAction<[rows: RequirementResource[]], boolean>(
    {
      handler: async (_ctx, rows) => {
        const ok = await dialog.confirm({
          title:
            rows.length === 1
              ? tr("requirements.requirement.delete.title")
              : tr("requirements.requirement.delete.title.many", {
                  args: [String(rows.length)],
                }),
          description:
            rows.length === 1
              ? tr("requirements.requirement.delete.description", {
                  args: [rows[0].statement],
                })
              : undefined,
          confirmLabel: tr("requirements.requirement.delete.confirm"),
          destructive: true,
        });
        if (!ok) return false;
        await Promise.all(
          rows.map((row) => api.deleteRequirement({ params: { id: row.id } })),
        );
        return true;
      },
      invalidates: [["requirements", projectId]],
    },
    [api, dialog, tr, projectId],
  );

  if (!project) return null;
  const canWrite = canInProject(project, "requirement:write");
  const pathOf = (row: RequirementResource) => ({
    params: {
      projectSlug: project.slug,
      requirementNumber: String(row.number),
    },
  });

  const filterFields = {
    search: { preset: "search" },
    status: {
      schema: z.array(requirementStatusSchema),
      label: tr("requirements.requirement.col.status"),
      icon: CircleDot,
      mode: "default",
      optionLabel: (status: RequirementResource["status"]) =>
        tr(REQUIREMENT_STATUS_LABEL_KEYS[status]),
      control: {
        clearLabel: tr("requirements.requirement.filter.anyStatus"),
      },
    },
    type: {
      schema: z.array(requirementTypeSchema),
      label: tr("requirements.requirement.field.type"),
      icon: Shapes,
      optionLabel: (type: RequirementResource["type"]) =>
        tr(REQUIREMENT_TYPE_LABEL_KEYS[type]),
      control: { clearLabel: tr("requirements.requirement.filter.anyType") },
    },
    verifiedBy: {
      schema: z.enum(["usecases", "metric", "none"]),
      label: tr("requirements.requirement.verifiedByFilter"),
      icon: ClipboardCheck,
      optionLabel: (value: "usecases" | "metric" | "none") =>
        tr(VERIFIED_BY_LABEL_KEYS[value]),
      control: {
        clearLabel: tr("requirements.requirement.filter.anyVerification"),
      },
    },
    // Release ids as strings, as the Epics and Quests lists hold them.
    // Hidden until the project has a release.
    release: {
      schema: z.array(z.string()),
      label: tr("requirements.requirement.release"),
      icon: Flag,
      items: props.releases.map((r) => ({
        value: String(r.id),
        label: r.tag ?? r.title ?? String(r.id),
      })),
      hidden: props.releases.length === 0,
      control: {
        clearLabel: tr("requirements.requirement.filter.allReleases"),
      },
    },
    // What the Source changed preset sets: one value, since "unchanged" is
    // not a question anybody asks of this list.
    sourceChanged: {
      schema: z.enum(["yes"]),
      label: tr("requirements.requirement.sourceChanged"),
      icon: FileWarning,
      optionLabel: () => tr("requirements.requirement.sourceChanged"),
    },
  } satisfies DataTableFilterFields;

  const matches = (
    row: RequirementResource,
    filters: DataTableFilterValues<typeof filterFields>,
  ) => {
    const needle = (filters.search ?? "").trim().toLowerCase();
    return (
      (!needle ||
        `s${row.number} ${row.statement} ${row.chapter ?? ""} ${row.paragraph ?? ""} ${row.description}`
          .toLowerCase()
          .includes(needle)) &&
      (!filters.status?.length || filters.status.includes(row.status)) &&
      (!filters.type?.length || filters.type.includes(row.type)) &&
      (!filters.verifiedBy ||
        (filters.verifiedBy === "usecases"
          ? row.criteria.length > 0
          : filters.verifiedBy === "metric"
            ? !!row.metric
            : row.criteria.length === 0 && !row.metric)) &&
      (!filters.release?.length ||
        (!!row.targetRelease &&
          filters.release.includes(String(row.targetRelease.id)))) &&
      (!filters.sourceChanged || !!row.sourceChanged)
    );
  };

  // Readiness is one release's: drawn while the filter names exactly one.
  const releaseId =
    releaseFilter.length === 1 ? Number(releaseFilter[0]) : undefined;
  const release = props.releases.find((it) => it.id === releaseId);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <DataTable<RequirementResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey={`lor.requirements.${project.id}`}
        data={all}
        filter={matches}
        defaultSort={{ field: "number", direction: "asc" }}
        emptyState={{
          icon: ListChecks,
          title: tr("requirements.requirement.empty.title"),
          description: tr("requirements.requirement.empty"),
          action: (
            <div className="flex flex-col items-center gap-3">
              {canWrite ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  {tr("project.menu.create-requirement")}
                </Button>
              ) : null}
              <GuideLink guide="plan-requirements" />
            </div>
          ),
        }}
        noMatchState={{
          description: tr("requirements.requirement.emptyFilter"),
        }}
        filters={{
          fields: filterFields,
          fromQuery: true,
          onChange: (values) => setReleaseFilter(values.release ?? []),
          presets: {
            items: [
              ...requirementStatusSchema.options.map((status) => ({
                key: status,
                label: tr(REQUIREMENT_STATUS_LABEL_KEYS[status]),
                // The rail cuts a long label: the tooltip says it whole.
                hint: tr(REQUIREMENT_STATUS_LABEL_KEYS[status]),
                icon: REQUIREMENT_STATUS_ICONS[status],
                tone:
                  status === "failing"
                    ? ("danger" as const)
                    : ("default" as const),
                count: all.filter((row) => row.status === status).length,
                values: { status: [status] },
              })),
              {
                key: "sourceChanged",
                label: tr("requirements.requirement.sourceChanged"),
                hint: tr("requirements.requirement.sourceChanged.hint"),
                icon: FileWarning,
                group: "source",
                tone: "danger" as const,
                count: all.filter((row) => row.sourceChanged).length,
                values: { sourceChanged: "yes" as const },
              },
            ],
            all: { label: tr("requirements.requirement.presets.all") },
          },
        }}
        summary={
          release
            ? {
                title: tr("requirements.trace.readiness", {
                  args: [release.tag ?? release.title ?? String(release.id)],
                }),
                content: (
                  <ReadinessBanner
                    release={release.tag ?? release.title ?? String(release.id)}
                    readiness={readinessOf(
                      requirementsOfRelease(all, release.id),
                    )}
                    blocks={
                      capabilityOption(project, "plan", "blockFailingMust") ===
                      true
                    }
                  />
                ),
              }
            : undefined
        }
        toolbar={<RequirementsViewSwitch view="list" />}
        actions={[
          ...(canWrite
            ? [
                {
                  icon: Plus,
                  label: tr("project.menu.create-requirement"),
                  primary: true,
                  onClick: () => setCreating(true),
                },
                {
                  icon: FileInput,
                  label: tr("requirements.requirement.import"),
                  onClick: () => setImporting(true),
                },
              ]
            : []),
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
            // A file the server answers with: a plain navigation, which the
            // browser turns into a download.
            onClick: () =>
              window.location.assign(
                `/api/projects/${projectId}/requirements/export${releaseId ? `?releaseId=${releaseId}` : ""}`,
              ),
          },
        ]}
        onRowHover={(row) => {
          if (row) router.prefetch("projectRequirement", pathOf(row));
        }}
        onRowClick={(row) =>
          void router.push("projectRequirement", pathOf(row))
        }
        rowActions={(row) =>
          canWrite
            ? [
                {
                  icon: Pencil,
                  label: tr("requirements.requirement.edit"),
                  onClick: () => setEditing(row),
                },
                {
                  icon: Trash2,
                  label: tr("requirements.persona.delete"),
                  destructive: true,
                  disabled: () => remove.loading,
                  onClick: async (item, ctx) => {
                    const result = await remove.run([item]);
                    if (result.ok && result.value) ctx.clearSelection();
                  },
                },
              ]
            : []
        }
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
            label: tr("requirements.requirement.col.requirement"),
            sortable: true,
            // The pair the Quests and Epics title columns carry: `max-w-0`
            // stops the column claiming its content width, `w-full` makes it
            // take the slack, so the ellipsis fires.
            className: "w-full max-w-0 min-w-48",
            cell: (row) => (
              <div
                className="overflow-hidden text-ellipsis whitespace-nowrap"
                title={row.statement}
                data-testid="requirement-row"
              >
                <ReferenceLink kind="requirement" number={row.number}>
                  {row.statement}
                </ReferenceLink>
              </div>
            ),
          },
          chapter: {
            label: tr("requirements.requirement.field.chapter"),
            sortable: true,
            sortValue: (row) => `${row.chapter ?? ""} ${row.paragraph ?? ""}`,
            className: "whitespace-nowrap",
            cell: (row) =>
              row.chapter || row.paragraph ? (
                <span className="text-sm">
                  {row.chapter}
                  {row.paragraph ? (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      §{row.paragraph}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          type: {
            label: tr("requirements.requirement.field.type"),
            sortable: true,
            className: "whitespace-nowrap",
            cell: (row) => tr(REQUIREMENT_TYPE_LABEL_KEYS[row.type]),
          },
          priority: {
            label: tr("requirements.requirement.field.priority"),
            sortable: true,
            sortValue: (row) => PRIORITY_RANK[row.priority],
            cell: (row) => <RequirementPriorityBadge priority={row.priority} />,
          },
          release: {
            label: tr("requirements.requirement.release"),
            sortable: true,
            sortValue: (row) =>
              row.targetRelease?.tag ?? row.targetRelease?.title ?? "",
            className: "whitespace-nowrap",
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
                <span className="text-muted-foreground">-</span>
              ),
          },
          verifiedBy: {
            label: tr("requirements.requirement.col.verifiedBy"),
            cell: (row) =>
              row.metric ? (
                <span className="text-xs">
                  {tr("requirements.requirement.metric")}
                </span>
              ) : row.criteria.length ? (
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
                <span className="text-muted-foreground">-</span>
              ),
          },
          status: {
            label: tr("requirements.requirement.col.status"),
            sortable: true,
            cell: (row) => <RequirementStatusChips requirement={row} />,
          },
        }}
      />
      <VerifyDialog
        subject={{ kind: "import" }}
        open={importing}
        onOpenChange={setImporting}
      />
      <RequirementSheet
        key={editing ? `edit-${editing.id}` : "new"}
        projectId={projectId}
        requirement={editing}
        open={creating || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(undefined);
          }
        }}
        onSubmit={(saved) => {
          const created = !editing;
          setCreating(false);
          setEditing(undefined);
          queries.invalidate(["requirements", projectId]);
          if (created) void router.push("projectRequirement", pathOf(saved));
        }}
      />
    </div>
  );
};

export default RequirementsList;

const VERIFIED_BY_LABEL_KEYS = {
  usecases: "requirements.requirement.filter.useCases",
  metric: "requirements.requirement.filter.metric",
  none: "requirements.requirement.filter.nothing",
} as const;

const PRIORITY_RANK = { must: 0, should: 1, could: 2, wont: 3 } as const;
