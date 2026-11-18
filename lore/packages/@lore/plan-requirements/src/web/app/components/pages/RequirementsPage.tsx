import { Button, Segmented } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
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
  ClipboardCheck,
  Download,
  FileInput,
  Flag,
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

const TYPES = ["functional", "non_functional", "constraint"] as const;
const STATUSES = [
  "verified",
  "failing",
  "in_development",
  "covered",
  "not_covered",
  "no_data",
] as const;

import { useSyncRequirementsCount } from "./useSyncRequirementsCount.ts";

/**
 * The Requirements page (#E153): counters, type,
 * verified-by and release filters, the list grouped by chapter, the detail
 * pane of the selected requirement (`?requirement=15`), a banner naming the
 * requirements whose source changed, the List / Matrix switch, a release's
 * readiness, and the exports (CSV, the test book). In the Matrix view the
 * pane holds the selected requirement's impact chain and the coverage
 * gaps (#Q3774).
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

  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"list" | "matrix">("list");
  const filters = useForm({
    id: "requirement-filters",
    schema: z.object({
      type: z.text().optional(),
      verifiedBy: z.text().optional(),
      release: z.text().optional(),
    }),
    // No initial value: an empty filter shows everything, and its
    // placeholder says so. No "All ..." row stands in for a value.
    handler: async () => {},
  });
  const values = useFormValues(filters);
  const type = values.type ?? "";
  const verifiedBy = values.verifiedBy ?? "";
  const release = values.release ?? "";
  const matrix = view === "matrix";
  const releaseId = release ? Number(release) : undefined;
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

  useSyncRequirementsCount("requirements", list.data);
  useSyncRequirementsCount("useCases", useCases.data);
  useSyncRequirementsCount("personas", personas.data);
  if (!project) return null;
  const all = list.data ?? [];
  const rows = all.filter(
    (it) =>
      (status === "all" || it.status === status) &&
      (!type || it.type === type) &&
      (!verifiedBy ||
        (verifiedBy === "usecases"
          ? it.criteria.length > 0
          : verifiedBy === "metric"
            ? !!it.metric
            : it.criteria.length === 0 && !it.metric)) &&
      (!releaseId || it.targetRelease?.id === releaseId),
  );
  const chapters = new Map<string, RequirementResource[]>();
  for (const row of rows) {
    const key = row.chapter ?? "";
    chapters.set(key, [...(chapters.get(key) ?? []), row]);
  }
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

  return (
    <RequirementsHover className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <form
          {...filters.props}
          className="[&_:is(input,[role=combobox])]:bg-background chrome flex flex-col gap-3 border-b p-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              size="sm"
              className="max-w-full overflow-x-auto"
              value={status}
              onChange={setStatus}
              options={[
                {
                  value: "all",
                  label: `${all.length} ${tr(all.length === 1 ? "requirements.requirement.counter.all.one" : "requirements.requirement.counter.all")}`,
                },
                ...STATUSES.map((it) => ({
                  value: it,
                  label: `${all.filter((row) => row.status === it).length} ${tr(REQUIREMENT_STATUS_LABEL_KEYS[it])}`,
                })),
              ]}
            />
            <div className="flex-1" />
            <Segmented
              size="sm"
              value={view}
              onChange={(value) => setView(value as "list" | "matrix")}
              options={[
                {
                  value: "list",
                  label: tr("requirements.requirement.view.list"),
                },
                {
                  value: "matrix",
                  label: tr("requirements.requirement.view.matrix"),
                },
              ]}
            />
            {canWrite ? (
              <Button
                type="button"
                variant="outlined"
                onClick={() => setImporting(true)}
              >
                <FileInput className="size-4" />
                {tr("requirements.requirement.import")}
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {tr("project.menu.create-requirement")}
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Control
              label={tr("requirements.requirement.field.type")}
              input={filters.input.type}
              select
              clearable
              icon={Shapes}
              placeholder={tr("requirements.requirement.filter.anyType")}
              clearLabel={tr("requirements.requirement.filter.anyType")}
              items={TYPES.map((it) => ({
                value: it,
                label: tr(REQUIREMENT_TYPE_LABEL_KEYS[it]),
              }))}
            />
            <Control
              label={tr("requirements.requirement.verifiedByFilter")}
              input={filters.input.verifiedBy}
              select
              clearable
              icon={ClipboardCheck}
              placeholder={tr(
                "requirements.requirement.filter.anyVerification",
              )}
              clearLabel={tr("requirements.requirement.filter.anyVerification")}
              items={[
                {
                  value: "usecases",
                  label: tr("requirements.requirement.filter.useCases"),
                },
                {
                  value: "metric",
                  label: tr("requirements.requirement.filter.metric"),
                },
                {
                  value: "none",
                  label: tr("requirements.requirement.filter.nothing"),
                },
              ]}
            />
            <Control
              label={tr("requirements.requirement.release")}
              input={filters.input.release}
              select
              clearable
              icon={Flag}
              placeholder={tr("requirements.requirement.filter.allReleases")}
              clearLabel={tr("requirements.requirement.filter.allReleases")}
              items={(releases.data ?? []).map((r) => ({
                value: String(r.id),
                label: r.tag ?? r.title ?? "",
              }))}
            />
          </div>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {changed.length ? (
            <WarningNotice className="mb-4" data-testid="source-changed-banner">
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
            <div className="mb-4">
              <ReadinessBanner
                release={
                  releases.data?.find((it) => it.id === releaseId)?.tag ??
                  release
                }
                readiness={readinessOf(requirementsOfRelease(all, releaseId))}
                blocks={
                  capabilityOption(project, "plan", "blockFailingMust") === true
                }
              />
            </div>
          ) : null}
          {matrix ? (
            <TraceabilityMatrix
              requirements={rows}
              useCases={useCases.data ?? []}
              personas={personas.data ?? []}
              selected={selected || undefined}
              onSelect={(number) => select(number)}
            />
          ) : list.data && rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr(
                all.length === 0
                  ? "requirements.requirement.empty"
                  : "requirements.requirement.emptyFilter",
              )}
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="requirements-table">
              <thead className="text-muted-foreground text-left text-xs">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">
                    {tr("requirements.requirement.col.requirement")}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {tr("requirements.requirement.field.type")}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {tr("requirements.requirement.field.priority")}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {tr("requirements.requirement.release")}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {tr("requirements.requirement.col.verifiedBy")}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {tr("requirements.requirement.col.status")}
                  </th>
                </tr>
              </thead>
              {[...chapters].map(([chapter, group]) => (
                <tbody key={chapter || "none"}>
                  <tr className="bg-muted/40 border-b">
                    <td colSpan={6} className="py-1.5 text-xs font-semibold">
                      {chapter || tr("requirements.requirement.noChapter")}
                    </td>
                  </tr>
                  {group.map((row) => (
                    <tr
                      key={row.id}
                      data-testid="requirement-row"
                      className={`hover:bg-muted/30 cursor-pointer border-b ${row.number === selected ? "bg-muted/50" : ""}`}
                      onClick={() => select(row.number)}
                    >
                      <td className="py-2 pr-3">
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
                      </td>
                      <td className="py-2 pr-3">
                        {tr(REQUIREMENT_TYPE_LABEL_KEYS[row.type])}
                      </td>
                      <td className="py-2 pr-3">
                        <RequirementPriorityBadge priority={row.priority} />
                      </td>
                      <td className="py-2 pr-3">
                        {row.targetRelease ? (
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
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.metric ? (
                          tr("requirements.requirement.metric")
                        ) : row.criteria.length ? (
                          <span className="flex flex-wrap gap-x-2">
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
                        )}
                      </td>
                      <td className="py-2">
                        <RequirementStatusChips requirement={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="outlined"
              size="sm"
              href={router.path("projectRequirementsTestBook", {
                params: { projectSlug: project.slug },
              })}
            >
              <BookOpen className="size-4" />
              {tr("requirements.trace.export.testBook")}
            </Button>
            <Button
              variant="outlined"
              size="sm"
              href={`/api/projects/${projectId}/requirements/export${releaseId ? `?releaseId=${releaseId}` : ""}`}
            >
              <Download className="size-4" />
              {tr("requirements.trace.export.csv")}
            </Button>
          </div>
        </div>
      </div>
      {matrix ? (
        <aside
          className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l p-3"
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
        <aside className="w-96 shrink-0 overflow-y-auto border-l">
          <RequirementDetail
            key={current.id}
            requirement={current}
            releases={releases.data ?? []}
            onChange={(next) => refresh(next)}
            onEdit={() => setEditing(true)}
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
