import { Card, CardContent } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { RequirementCoverageController } from "../../../../api/controllers/RequirementCoverageController.ts";
import type { RequirementImpact } from "../../../../api/schemas/requirementCoverageSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import { formatMetricValue, metricLine } from "../requirements/metricText.ts";

export interface ImpactChainProps {
  projectId: number;
  requirement: RequirementResource;
}

const RESULT_KEYS = {
  passed: "requirements.run.result.passed",
  failed: "requirements.run.result.failed",
  not_run: "requirements.run.result.not_run",
} as const;

const Step = (props: {
  label: string;
  tone: string;
  children: React.ReactNode;
}) => (
  <li className="relative flex gap-3 pb-3">
    <span className={`mt-1 size-2.5 shrink-0 rounded-full ${props.tone}`} />
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] font-semibold uppercase">
        {props.label}
      </span>
      {props.children}
    </div>
  </li>
);

/**
 * A requirement's impact chain (#E153, #Q3774): the requirement, its
 * criteria per use case, the epics covering them, their quests and
 * commits, the errors its criteria opened, and its release, or its metric.
 */
const ImpactChain = (props: ImpactChainProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<RequirementCoverageController>();
  const it = props.requirement;
  const impact = useQuery<RequirementImpact>(
    {
      key: ["requirement-impact", props.projectId, it.number, it.updatedAt],
      enabled: props.projectId > 0,
      handler: async () =>
        await api.getRequirementImpact({
          params: { projectId: props.projectId, number: it.number },
        }),
    },
    [api, props.projectId, it.number, it.updatedAt],
  );
  const data = impact.data;
  return (
    <Card data-testid="impact-chain">
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <h3 className="font-semibold">{tr("requirements.trace.impact")}</h3>
          <span className="text-muted-foreground text-xs">
            {formatReference("requirement", it.number)}
          </span>
        </div>
        <ol>
          <Step
            label={tr("requirements.trace.step.requirement")}
            tone="bg-blue-600"
          >
            <span>
              {formatReference("requirement", it.number)} {it.statement}
            </span>
            <span className="text-muted-foreground text-xs">
              {[it.paragraph ? `§${it.paragraph}` : undefined, it.priority]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Step>
          {it.metric ? (
            <Step
              label={tr("requirements.requirement.metric")}
              tone="bg-violet-600"
            >
              <span className="font-mono text-xs">{metricLine(it.metric)}</span>
              <span className="text-muted-foreground text-xs">
                {it.metricValue !== undefined
                  ? formatMetricValue(it.metric, it.metricValue)
                  : tr("requirements.requirement.status.no_data")}
              </span>
            </Step>
          ) : null}
          {data?.useCases.length ? (
            <Step
              label={tr("requirements.trace.step.useCases")}
              tone="bg-orange-600"
            >
              {data.useCases.map((uc) => (
                <span key={uc.number}>
                  {formatReference("usecase", uc.number)}{" "}
                  {uc.criteria
                    .map(
                      (c) =>
                        `${c.key} ${tr(RESULT_KEYS[c.result ?? "not_run"])}`,
                    )
                    .join(" · ")}
                  {uc.stale ? ` (${tr("requirements.run.stale")})` : ""}
                </span>
              ))}
            </Step>
          ) : null}
          {data?.epics.length ? (
            <Step
              label={tr("requirements.trace.step.epics")}
              tone="bg-slate-500"
            >
              {data.epics.map((epic) => (
                <span key={epic.number}>
                  {formatReference("epic", epic.number)} {epic.title}{" "}
                  <span className="text-muted-foreground text-xs">
                    {tr("requirements.usecase.development", {
                      args: [String(epic.done), String(epic.total)],
                    })}
                  </span>
                </span>
              ))}
            </Step>
          ) : null}
          {data?.quests.length ? (
            <Step
              label={tr("requirements.trace.step.quests")}
              tone="bg-slate-500"
            >
              <span>
                {data.quests
                  .map((q) => formatReference("quest", q.number))
                  .join(" · ")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("requirements.trace.commits", {
                  args: [String(data.commits.count), data.commits.last ?? "-"],
                })}
              </span>
            </Step>
          ) : null}
          {data?.errors.length ? (
            <Step
              label={tr("requirements.trace.step.errors")}
              tone="bg-orange-600"
            >
              {data.errors.map((error) => (
                <span key={error.id}>
                  {error.name}{" "}
                  <span className="text-muted-foreground text-xs">
                    {error.status}
                  </span>
                </span>
              ))}
            </Step>
          ) : null}
          <Step
            label={tr("requirements.trace.step.release")}
            tone="bg-foreground"
          >
            <span>
              {it.targetRelease
                ? (it.targetRelease.tag ?? it.targetRelease.title)
                : tr("requirements.requirement.release.none")}
            </span>
          </Step>
        </ol>
      </CardContent>
    </Card>
  );
};

export default ImpactChain;
