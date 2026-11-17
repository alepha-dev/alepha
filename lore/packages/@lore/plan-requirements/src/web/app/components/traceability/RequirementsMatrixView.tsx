import { Control } from "@alepha/ui/form";
import {
  canInProject,
  capabilityOption,
  currentProjectAtom,
  type I18n,
} from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Flag } from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
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
import RequirementsViewSwitch from "../requirements/RequirementsViewSwitch.tsx";
import RequirementsHover from "../shared/RequirementsHover.tsx";
import CoverageGaps from "./CoverageGaps.tsx";
import ImpactChain from "./ImpactChain.tsx";
import ReadinessBanner from "./ReadinessBanner.tsx";
import TraceabilityMatrix from "./TraceabilityMatrix.tsx";

export interface RequirementsMatrixViewProps {
  requirements: RequirementResource[];
  releases: Array<{ id: number; tag?: string; title?: string }>;
}

/**
 * The Matrix view of the Requirements tab (#E153, #Q3774): the traceability
 * matrix, a release filter that draws the release's readiness, and a pane
 * holding the selected requirement's impact chain and the coverage gaps.
 */
const RequirementsMatrixView = (props: RequirementsMatrixViewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  const personaApi = useClient<PersonaController>();
  const coverageApi = useClient<RequirementCoverageController>();
  const projectId = project?.id ?? 0;
  const [selected, setSelected] = useState<number>();

  const filters = useForm({
    id: "requirements-matrix-filters",
    schema: z.object({ release: z.text().optional() }),
    handler: async () => {},
  });
  const { release } = useFormValues(filters);
  const releaseId = release ? Number(release) : undefined;

  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId],
  );
  const personas = useQuery<PersonaResource[]>(
    {
      key: ["personas", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await personaApi.getPersonas({ params: { projectId }, query: {} }),
    },
    [personaApi, projectId],
  );
  const coverage = useQuery<RequirementCoverage>(
    {
      key: ["requirement-coverage", projectId, releaseId ?? 0],
      enabled: projectId > 0,
      handler: async () =>
        await coverageApi.getRequirementCoverage({
          params: { projectId },
          query: releaseId ? { releaseId } : {},
        }),
    },
    [coverageApi, projectId, releaseId],
  );

  if (!project) return null;
  const all = props.requirements;
  const rows = releaseId
    ? all.filter((it) => it.targetRelease?.id === releaseId)
    : all;
  const current = all.find((it) => it.number === selected);
  const named = props.releases.find((it) => it.id === releaseId);

  return (
    <RequirementsHover className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <form
          {...filters.props}
          className="chrome flex flex-wrap items-center gap-2 border-b p-2"
        >
          {props.releases.length > 0 ? (
            <div className="w-48">
              <Control
                input={filters.input.release}
                label=""
                select
                size="sm"
                clearable
                icon={Flag}
                placeholder={tr("requirements.requirement.filter.allReleases")}
                clearLabel={tr("requirements.requirement.filter.allReleases")}
                triggerClassName="w-full"
                inputProps={{
                  "aria-label": tr("requirements.requirement.release"),
                  "data-testid": "matrix-release",
                }}
                items={props.releases.map((r) => ({
                  value: String(r.id),
                  label: r.tag ?? r.title ?? String(r.id),
                }))}
              />
            </div>
          ) : null}
          <div className="flex-1" />
          <RequirementsViewSwitch view="matrix" />
        </form>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {named ? (
            <ReadinessBanner
              release={named.tag ?? named.title ?? String(named.id)}
              readiness={readinessOf(requirementsOfRelease(all, named.id))}
              blocks={
                capabilityOption(project, "plan", "blockFailingMust") === true
              }
            />
          ) : null}
          <TraceabilityMatrix
            requirements={rows}
            useCases={useCases.data ?? []}
            personas={personas.data ?? []}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      </div>
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
            canWrite={canInProject(project, "requirement:write")}
            coverage={coverage.data}
          />
        ) : null}
      </aside>
    </RequirementsHover>
  );
};

export default RequirementsMatrixView;
