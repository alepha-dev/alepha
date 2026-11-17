import { Button, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import { currentProjectAtom, type I18n, LoreViewer } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import MetricSparkline from "./MetricSparkline.tsx";
import { formatMetricValue, metricLine } from "./metricText.ts";
import RequirementStatusChips from "./RequirementStatusChips.tsx";

export interface RequirementOverviewProps {
  requirement: RequirementResource;
  canWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onKeep: () => void;
}

/**
 * A requirement's Overview tab (#E153): Source changed's Update / Keep, its
 * description, the metric verifying it and the criteria verifying it.
 */
const RequirementOverview = (props: RequirementOverviewProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const [project] = useStore(currentProjectAtom);
  const it = props.requirement;

  return (
    <div className="flex flex-col gap-4" data-testid="requirement-detail">
      {it.sourceChanged ? (
        <Card data-testid="source-changed-panel">
          <CardHeader>
            <CardTitle>
              {tr(
                it.sourceChangeKind === "removed"
                  ? "requirements.requirement.source.removed"
                  : "requirements.requirement.source.edited",
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {it.sourceSectionText ? (
              <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs whitespace-pre-wrap">
                {it.sourceSectionText}
              </blockquote>
            ) : null}
            {props.canWrite ? (
              <div className="flex gap-2">
                <Button
                  variant="outlined"
                  disabled={props.busy}
                  onClick={props.onEdit}
                >
                  {tr("requirements.requirement.source.update")}
                </Button>
                <Button
                  variant="outlined"
                  disabled={props.busy}
                  onClick={props.onKeep}
                >
                  {tr("requirements.requirement.source.keep")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {tr("requirements.requirement.field.description")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {it.description ? (
            <LoreViewer
              element={{
                kind: "requirement",
                projectId: it.projectId,
                projectSlug: project?.slug ?? "",
                id: it.id,
              }}
              content={it.description}
            />
          ) : (
            <p className="text-muted-foreground text-sm italic">
              {tr("requirements.requirement.description.empty")}
            </p>
          )}
        </CardContent>
      </Card>

      {it.metric ? (
        <Card data-testid="requirement-metric">
          <CardHeader>
            <CardTitle>{tr("requirements.requirement.metric.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="font-mono text-xs">{metricLine(it.metric)}</p>
            {it.metricValue !== undefined && it.metricStatus !== "no_data" ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-semibold">
                  {formatMetricValue(it.metric, it.metricValue)}
                </span>
                <RequirementStatusChips requirement={it} />
                {it.metricStatusSince ? (
                  <span className="text-muted-foreground text-xs">
                    {tr("requirements.requirement.metric.since", {
                      args: [i18n.l(it.metricStatusSince, { date: "ll" })],
                    })}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                {tr("requirements.requirement.metric.empty")}
              </p>
            )}
            <MetricSparkline days={it.metricDays} />
            {it.metricEvaluatedAt ? (
              <p className="text-muted-foreground text-xs">
                {tr("requirements.requirement.metric.evaluated", {
                  args: [i18n.l(it.metricEvaluatedAt, { date: "lll" })],
                })}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {tr("requirements.requirement.metric.alephaOnly")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!it.metric || it.criteria.length ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {tr(
                it.criteria.length === 1
                  ? "requirements.requirement.verifiedBy.one"
                  : "requirements.requirement.verifiedBy",
                { args: [String(it.criteria.length)] },
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {it.criteria.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">
                {tr("requirements.requirement.verifiedBy.none")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {it.criteria.map((c) => (
                  <li key={`${c.useCaseNumber}:${c.key}`}>
                    <ReferenceLink kind="usecase" number={c.useCaseNumber}>
                      <span className="font-semibold">{c.key}</span>
                    </ReferenceLink>{" "}
                    <span className="text-muted-foreground">{c.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default RequirementOverview;
