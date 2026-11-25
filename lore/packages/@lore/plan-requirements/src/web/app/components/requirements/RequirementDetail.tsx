import { Button, Card, CardContent, useDialog } from "@alepha/ui";
import {
  canInProject,
  currentProjectAtom,
  formatReference,
  type I18n,
  LoreViewer,
  PinnedPromptsButton,
} from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Trash2, X } from "lucide-react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import MetricSparkline from "./MetricSparkline.tsx";
import { formatMetricValue, metricLine } from "./metricText.ts";
import { REQUIREMENT_TYPE_LABEL_KEYS } from "./requirementLabels.ts";
import RequirementPriorityBadge from "./RequirementPriorityBadge.tsx";
import RequirementReleaseControl from "./RequirementReleaseControl.tsx";
import RequirementStatusChips from "./RequirementStatusChips.tsx";

export interface RequirementDetailProps {
  requirement: RequirementResource;
  releases: Array<{ id: number; tag?: string; title?: string }>;
  onChange: (requirement: RequirementResource) => void;
  onEdit: () => void;
  onDeleted: () => void;
  /**
   * Closes the pane, giving the list the whole width back.
   */
  onClose?: () => void;
}

/**
 * The detail pane beside the Requirements list (#E153): statement, type and
 * priority, source, the personas concerned (through the use cases), the
 * Target release (`RequirementReleaseControl`), the criteria verifying it,
 * and Source changed's Update / Keep.
 */
const RequirementDetail = (props: RequirementDetailProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const it = props.requirement;
  const canWrite = !!project && canInProject(project, "requirement:write");

  const resync = useAction<[], void>(
    {
      handler: async () => {
        props.onChange(
          await api.resyncRequirementSource({ params: { id: it.id } }),
        );
      },
    },
    [api, it.id, props.onChange],
  );

  const remove = useAction<[], void>(
    {
      handler: async () => {
        const ok = await dialog.confirm({
          title: tr("requirements.requirement.delete.title"),
          description: tr("requirements.requirement.delete.description", {
            args: [it.statement],
          }),
          confirmLabel: tr("requirements.requirement.delete.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await api.deleteRequirement({ params: { id: it.id } });
        props.onDeleted();
      },
    },
    [api, it.id, it.statement, dialog, tr, props.onDeleted],
  );

  const busy = remove.loading || resync.loading;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="requirement-detail">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono">
          {formatReference("requirement", it.number)}
        </span>
        {it.paragraph ? (
          <span className="text-muted-foreground">§{it.paragraph}</span>
        ) : null}
        <RequirementStatusChips requirement={it} />
        {/* The prompts pinned on the Requirement view (#Q4412), the
            requirement filled in. */}
        <span className="ms-auto">
          <PinnedPromptsButton
            page="requirement"
            item={{ type: "requirement", value: String(it.number) }}
          />
        </span>
        {props.onClose ? (
          <Button
            variant="minimal"
            size="icon-sm"
            aria-label={tr("common.close")}
            title={tr("common.close")}
            onClick={props.onClose}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      <h2 className="text-lg font-semibold">{it.statement}</h2>
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
      ) : null}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">
          {tr("requirements.requirement.field.type")}
        </dt>
        <dd className="flex flex-wrap items-center gap-2">
          {tr(REQUIREMENT_TYPE_LABEL_KEYS[it.type])}
          <RequirementPriorityBadge priority={it.priority} />
        </dd>
        {it.chapter ? (
          <>
            <dt className="text-muted-foreground">
              {tr("requirements.requirement.field.chapter")}
            </dt>
            <dd>{it.chapter}</dd>
          </>
        ) : null}
        {it.sourceFolioId ? (
          <>
            <dt className="text-muted-foreground">
              {tr("requirements.requirement.field.source")}
            </dt>
            <dd>
              {it.sourceAnchor
                ? `#${it.sourceAnchor}`
                : tr("requirements.requirement.source.whole")}
            </dd>
          </>
        ) : null}
        {it.personas.length ? (
          <>
            <dt className="text-muted-foreground">
              {tr("requirements.requirement.field.personas")}
            </dt>
            <dd>
              {it.personas.map((p) => (
                <span key={p.number} className="mr-2">
                  <ReferenceLink kind="persona" number={p.number}>
                    {p.name}
                  </ReferenceLink>
                </span>
              ))}
              <span className="text-muted-foreground text-xs">
                {tr("requirements.requirement.personas.through")}
              </span>
            </dd>
          </>
        ) : null}
      </dl>

      {it.sourceChanged ? (
        <Card>
          <CardContent
            className="flex flex-col gap-2 text-sm"
            data-testid="source-changed-panel"
          >
            <p className="font-semibold">
              {tr(
                it.sourceChangeKind === "removed"
                  ? "requirements.requirement.source.removed"
                  : "requirements.requirement.source.edited",
              )}
            </p>
            {it.sourceSectionText ? (
              <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs whitespace-pre-wrap">
                {it.sourceSectionText}
              </blockquote>
            ) : null}
            {canWrite ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outlined"
                  disabled={busy}
                  onClick={props.onEdit}
                >
                  {tr("requirements.requirement.source.update")}
                </Button>
                <Button
                  size="sm"
                  variant="outlined"
                  disabled={busy}
                  onClick={() => void resync.run()}
                >
                  {tr("requirements.requirement.source.keep")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <span className="text-muted-foreground text-xs font-medium">
            {tr("requirements.requirement.release")}
          </span>
          <RequirementReleaseControl
            requirement={it}
            releases={props.releases}
            disabled={!canWrite || busy}
            onChange={props.onChange}
          />
        </CardContent>
      </Card>

      {it.metric ? (
        <Card data-testid="requirement-metric">
          <CardContent className="flex flex-col gap-2 text-sm">
            <h3 className="font-semibold">
              {tr("requirements.requirement.metric.title")}
            </h3>
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
          <CardContent className="flex flex-col gap-2 text-sm">
            <h3 className="font-semibold">
              {tr(
                it.criteria.length === 1
                  ? "requirements.requirement.verifiedBy.one"
                  : "requirements.requirement.verifiedBy",
                { args: [String(it.criteria.length)] },
              )}
            </h3>
            {it.criteria.length === 0 ? (
              <p className="text-muted-foreground text-xs">
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

      {canWrite ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outlined"
            disabled={busy}
            onClick={props.onEdit}
          >
            <Pencil className="size-4" />
            {tr("requirements.requirement.edit")}
          </Button>
          <Button
            size="sm"
            variant="outlined"
            intent="danger"
            disabled={busy}
            onClick={() => void remove.run()}
          >
            <Trash2 className="size-4" />
            {tr("requirements.persona.delete")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default RequirementDetail;
