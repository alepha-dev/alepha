import { Card, CardContent } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { RequirementCoverageController } from "../../../../api/controllers/RequirementCoverageController.ts";
import type { RequirementImpact } from "../../../../api/schemas/requirementCoverageSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import { formatMetricValue, metricLine } from "../requirements/metricText.ts";
import { REQUIREMENT_PRIORITY_LABEL_KEYS } from "../requirements/requirementLabels.ts";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import { developmentKey } from "../usecases/developmentKey.ts";
import ImpactChainStep from "./ImpactChainStep.tsx";

export interface ImpactChainProps {
  projectId: number;
  requirement: RequirementResource;
}

const RESULT_KEYS = {
  passed: "requirements.run.result.passed",
  failed: "requirements.run.result.failed",
  not_run: "requirements.run.result.not_run",
} as const;

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
          <span className="text-muted-foreground font-mono text-xs">
            {formatReference("requirement", it.number)}
          </span>
        </div>
        <ol>
          <ImpactChainStep
            label={tr("requirements.trace.step.requirement")}
            tone="bg-primary"
          >
            <ReferenceLink kind="requirement" number={it.number}>
              {it.statement}
            </ReferenceLink>
            <span className="text-muted-foreground text-xs">
              {[
                it.paragraph ? `§${it.paragraph}` : undefined,
                tr(REQUIREMENT_PRIORITY_LABEL_KEYS[it.priority]),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </ImpactChainStep>
          {it.metric ? (
            <ImpactChainStep
              label={tr("requirements.requirement.metric")}
              tone="bg-primary/60"
            >
              <span className="font-mono text-xs">{metricLine(it.metric)}</span>
              <span className="text-muted-foreground text-xs">
                {it.metricValue !== undefined
                  ? formatMetricValue(it.metric, it.metricValue)
                  : tr("requirements.requirement.status.no_data")}
              </span>
            </ImpactChainStep>
          ) : null}
          {data?.useCases.length ? (
            <ImpactChainStep
              label={tr("requirements.trace.step.useCases")}
              tone="bg-warning"
            >
              {data.useCases.map((uc) => (
                <span key={uc.number}>
                  <ReferenceLink kind="usecase" number={uc.number} />{" "}
                  {uc.criteria
                    .map(
                      (c) =>
                        `${c.key} ${tr(RESULT_KEYS[c.result ?? "not_run"])}`,
                    )
                    .join(" · ")}
                  {uc.stale ? ` (${tr("requirements.run.stale")})` : ""}
                </span>
              ))}
            </ImpactChainStep>
          ) : null}
          {data?.epics.length ? (
            <ImpactChainStep
              label={tr("requirements.trace.step.epics")}
              tone="bg-muted-foreground"
            >
              {data.epics.map((epic) => (
                <span key={epic.number}>
                  <ReferenceLink kind="epic" number={epic.number}>
                    {epic.title}
                  </ReferenceLink>{" "}
                  <span className="text-muted-foreground text-xs">
                    {tr(developmentKey(epic.total), {
                      args: [String(epic.done), String(epic.total)],
                    })}
                  </span>
                </span>
              ))}
            </ImpactChainStep>
          ) : null}
          {data?.quests.length ? (
            <ImpactChainStep
              label={tr("requirements.trace.step.quests")}
              tone="bg-muted-foreground"
            >
              <span className="flex flex-wrap gap-x-2">
                {data.quests.map((q) => (
                  <ReferenceLink
                    key={q.number}
                    kind="quest"
                    number={q.number}
                  />
                ))}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr(
                  data.commits.count === 1
                    ? "requirements.trace.commits.one"
                    : "requirements.trace.commits",
                  {
                    args: [
                      String(data.commits.count),
                      data.commits.last ?? "-",
                    ],
                  },
                )}
              </span>
            </ImpactChainStep>
          ) : null}
          {data?.errors.length ? (
            <ImpactChainStep
              label={tr("requirements.trace.step.errors")}
              tone="bg-warning"
            >
              {data.errors.map((error) => (
                <span key={error.id}>
                  {error.name}{" "}
                  <span className="text-muted-foreground text-xs">
                    {error.status}
                  </span>
                </span>
              ))}
            </ImpactChainStep>
          ) : null}
          <ImpactChainStep
            label={tr("requirements.trace.step.release")}
            tone="bg-foreground"
          >
            <span>
              {it.targetRelease
                ? (it.targetRelease.tag ?? it.targetRelease.title)
                : tr("requirements.requirement.release.none")}
            </span>
          </ImpactChainStep>
        </ol>
      </CardContent>
    </Card>
  );
};

export default ImpactChain;
