import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQueryClient, useStore } from "alepha/react";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationEvaluationReport } from "../../../../../api/schemas/automationEvaluationReportSchema.ts";
import { automationPreviewSubjectFormSchema } from "../../../../../api/schemas/automationPreviewSubjectFormSchema.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationRuleSummary from "./AutomationRuleSummary.tsx";
import { useAutomationSetupChoices } from "./useAutomationSetupChoices.ts";

export interface AutomationCreatedRuleProps {
  rule: AutomationResource;
  detail?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  labels?: Record<string, string>;
  onChange: (rule: AutomationResource) => void;
}

const AutomationCreatedRule = (props: AutomationCreatedRuleProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AutomationRouter>();
  const [report, setReport] = useState<AutomationEvaluationReport>();
  const event = props.rule.rule?.trigger.kind === "event";
  const sourceKind =
    props.rule.rule?.trigger.kind === "event"
      ? props.rule.rule.trigger.event.split(".")[0]
      : "quest";
  const subjects = useAutomationSetupChoices(
    sourceKind === "deploy"
      ? "deployment"
      : (sourceKind as "quest" | "release" | "epic" | "feedback"),
    event,
  );
  const form = useForm(
    {
      schema: automationPreviewSubjectFormSchema,
      handler: async (values) => {
        const subject = values.subject?.trim();
        if (event && !subject)
          throw new FormValidationError({
            path: "subject",
            message: tr("automation.test.subjectRequired"),
          });
        const numeric = Number(subject);
        const source = event
          ? {
              kind: "subject" as const,
              id:
                Number.isSafeInteger(numeric) && numeric > 0
                  ? numeric
                  : subject!,
            }
          : undefined;
        setReport(
          await api.testAutomation({
            params: { projectId: props.rule.projectId, id: props.rule.id },
            body: source ? { source } : {},
          }),
        );
      },
      onChange: () => setReport(undefined),
    },
    [props.rule.id],
  );
  const testState = useFormState(form, ["loading"]);
  const enable = useAction<[], boolean>(
    {
      handler: async () => {
        const updated = await api.setAutomationEnabled({
          params: { projectId: props.rule.projectId, id: props.rule.id },
          body: { enabled: true, expectedRevision: props.rule.revision },
        });
        props.onChange(updated);
        queries.invalidate(["automations", props.rule.projectId]);
        return true;
      },
    },
    [api, props.rule, props.onChange, queries],
  );
  const localBusy = testState.loading || enable.loading;
  useEffect(() => {
    props.onBusyChange?.(localBusy);
    return () => props.onBusyChange?.(false);
  }, [localBusy, props.onBusyChange]);
  const busy = localBusy || props.disabled;
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      {!props.detail && (
        <p className="text-muted-foreground text-sm">
          {tr("automation.setup.created")}
        </p>
      )}
      <AutomationRuleSummary rule={props.rule} labels={props.labels} />
      <form {...form.props} className="flex flex-col gap-3">
        <h3 className="font-medium">{tr("automation.test.title")}</h3>
        <p className="text-muted-foreground text-sm">
          {tr("automation.test.description")}
        </p>
        {event && (
          <Control
            input={form.input.subject}
            label={tr("automation.test.subject")}
            description={tr("automation.test.subjectDescription")}
            select
            items={subjects.items}
            disabled={busy || subjects.navigation.loading}
          />
        )}
        {event &&
          (subjects.navigation.hasMore || subjects.navigation.offset > 0) && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="minimal"
                disabled={
                  busy ||
                  subjects.navigation.loading ||
                  !subjects.navigation.offset
                }
                onClick={subjects.navigation.previous}
              >
                {tr("automation.previous")}
              </Button>
              <Button
                type="button"
                variant="minimal"
                disabled={
                  busy ||
                  subjects.navigation.loading ||
                  !subjects.navigation.hasMore
                }
                onClick={subjects.navigation.next}
              >
                {tr("automation.next")}
              </Button>
            </div>
          )}
        <Button
          type="submit"
          variant="outlined"
          className="self-start"
          loading={testState.loading}
          disabled={busy}
        >
          {tr("automation.test.run")}
        </Button>
      </form>
      {report && (
        <section
          className="border-border flex flex-col gap-3 rounded-md border p-4"
          aria-label={tr("automation.test.result")}
        >
          <p className="text-muted-foreground text-xs">
            {tr("automation.test.at", {
              args: [l(report.evaluatedAt, { date: "lll" })],
            })}
          </p>
          <p>
            {report.status === "refused"
              ? report.reason
              : tr("automation.test.planned", {
                  args: [l(report.operations.length)],
                })}
          </p>
          <p className="text-muted-foreground text-sm">
            {tr("automation.test.counts", {
              args: [l(report.counts.selected), l(report.counts.matched)],
            })}
          </p>
          <p className="text-muted-foreground text-xs">
            {tr(
              report.counts.totalIsExact
                ? "automation.test.total"
                : "automation.test.lowerBound",
              { args: [l(report.counts.total)] },
            )}
          </p>
          {report.guards.map((guard, index) => (
            <p className="text-sm" key={index}>
              {guard.matched
                ? tr("automation.test.guardMatched")
                : tr("automation.test.guardNotMatched")}
              {guard.value !== undefined &&
                ` ${tr("automation.test.value", { args: [l(guard.value)] })}`}
              {guard.previous !== undefined &&
                ` ${tr("automation.test.previous", { args: [l(guard.previous)] })}`}
            </p>
          ))}
          {report.operationsOmitted > 0 && (
            <p>
              {tr("automation.test.omitted", {
                args: [l(report.operationsOmitted)],
              })}
            </p>
          )}
          {report.noData && <p>{tr("automation.run.noData")}</p>}
          {report.counts.truncated && <p>{tr("automation.run.capped")}</p>}
          {report.operations.map((operation, index) => (
            <div key={index} className="border-border border-t pt-3 text-sm">
              {operation.audience && (
                <p>
                  {tr("automation.adoption.audiencePreview", {
                    args: [String(operation.audience.total)],
                  })}
                  {operation.audience.recipients
                    .map((item) => item.label)
                    .join(", ")}
                </p>
              )}
              {operation.delivery ? (
                <>
                  <p className="font-medium break-words">
                    {operation.delivery.title}
                  </p>
                  <p className="break-words whitespace-pre-wrap">
                    {operation.delivery.text}
                  </p>
                </>
              ) : (
                <p className="break-words whitespace-pre-wrap">
                  {operation.rendered.kind === "appendFolio"
                    ? operation.rendered.text
                    : operation.rendered.kind === "notify"
                      ? `${operation.rendered.title}\n${operation.rendered.text}`
                      : operation.rendered.kind}
                </p>
              )}
              {operation.truncated && (
                <p className="text-muted-foreground">
                  {tr("automation.test.actionCapped")}
                </p>
              )}
              {operation.skipped && (
                <p className="text-muted-foreground">
                  {operation.reason || tr("automation.run.skipped")}
                </p>
              )}
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            {tr("automation.test.disclaimer")}
          </p>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!props.rule.enabled && props.rule.canEnable && (
          <Button
            intent="primary"
            loading={enable.loading}
            disabled={busy}
            onClick={() => void enable.run()}
          >
            {tr("automation.enable")}
          </Button>
        )}
        <Button
          variant="minimal"
          disabled={busy}
          onClick={() =>
            router.push("projectAutomations", {
              params: { projectSlug: project!.slug },
            })
          }
        >
          {tr("automation.gallery.back")}
        </Button>
      </div>
      {!props.rule.enabled && (
        <p className="text-muted-foreground text-xs">
          {tr("automation.setup.enableDescription")}
        </p>
      )}
    </div>
  );
};

export default AutomationCreatedRule;
