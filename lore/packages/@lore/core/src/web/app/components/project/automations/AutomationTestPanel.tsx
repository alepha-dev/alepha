import { Button } from "@alepha/ui";
import { ControlSelect } from "@alepha/ui/form";
import { useClient } from "alepha/react";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationEvaluationReport } from "../../../../../api/schemas/automationEvaluationReportSchema.ts";
import { automationPreviewSubjectFormSchema } from "../../../../../api/schemas/automationPreviewSubjectFormSchema.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import {
  AUTOMATION_OPTION_THRESHOLD,
  type AutomationOptionKind,
  useAutomationOptions,
} from "./useAutomationOptions.ts";

export interface AutomationTestPanelProps {
  rule: AutomationResource;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

/**
 * A dry run of the rule against current data: what it would select, whether
 * its condition holds and the exact messages it would send. Nothing is
 * written, so it can be run as often as needed, enabled or not.
 */
const AutomationTestPanel = (props: AutomationTestPanelProps) => {
  const api = useClient<AutomationController>();
  const { tr, l } = useI18n<I18n, "en">();
  const [report, setReport] = useState<AutomationEvaluationReport>();
  const event = props.rule.rule?.trigger.kind === "event";
  const sourceKind =
    props.rule.rule?.trigger.kind === "event"
      ? props.rule.rule.trigger.event.split(".")[0]
      : "quest";
  const subjects = useAutomationOptions(
    (sourceKind === "deploy"
      ? "deployment"
      : sourceKind) as AutomationOptionKind,
  );
  const form = useForm(
    {
      schema: automationPreviewSubjectFormSchema,
      handler: async (values) => {
        const subject = values.subject?.trim();
        if (event && !subject)
          throw new FormValidationError({
            path: "/subject",
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
    [props.rule.id, props.rule.revision],
  );
  const testState = useFormState(form, ["loading"]);
  useEffect(() => {
    props.onBusyChange?.(testState.loading);
    return () => props.onBusyChange?.(false);
  }, [testState.loading, props.onBusyChange]);
  const busy = testState.loading || props.disabled;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-medium">{tr("automation.test.title")}</h2>
        <p className="text-muted-foreground text-sm">
          {tr("automation.test.description")}
        </p>
      </div>
      <form
        {...form.props}
        className="bg-card flex flex-col gap-3 rounded-lg border p-4"
      >
        {event && (
          <ControlSelect
            input={form.input.subject}
            label={tr("automation.test.subject")}
            description={tr("automation.test.subjectDescription")}
            items={subjects}
            loaderThreshold={AUTOMATION_OPTION_THRESHOLD}
            disabled={busy}
          />
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
        {report && (
          <div
            className="flex flex-col gap-3 border-t pt-3"
            aria-label={tr("automation.test.result")}
          >
            <p className="text-muted-foreground text-xs">
              {tr("automation.test.at", {
                args: [l(report.evaluatedAt, { date: "lll" })],
              })}
            </p>
            <p className="font-medium">
              {report.status === "refused"
                ? report.reason
                : tr("automation.test.planned", {
                    args: [l(report.operations.length)],
                  })}
            </p>
            <p className="text-muted-foreground text-sm">
              {tr("automation.test.counts", {
                args: [l(report.counts.selected), l(report.counts.matched)],
              })}{" "}
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
              <p className="text-sm">
                {tr("automation.test.omitted", {
                  args: [l(report.operationsOmitted)],
                })}
              </p>
            )}
            {report.noData && (
              <p className="text-sm">{tr("automation.run.noData")}</p>
            )}
            {report.counts.truncated && (
              <p className="text-sm">{tr("automation.run.capped")}</p>
            )}
            {report.operations.map((operation, index) => (
              <div
                key={index}
                className="bg-muted/40 flex flex-col gap-1 rounded-md border p-3 text-sm"
              >
                {operation.audience && (
                  <p className="text-muted-foreground text-xs">
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
                  <p className="text-muted-foreground text-xs">
                    {tr("automation.test.actionCapped")}
                  </p>
                )}
                {operation.skipped && (
                  <p className="text-muted-foreground text-xs">
                    {operation.reason || tr("automation.run.skipped")}
                  </p>
                )}
              </div>
            ))}
            <p className="text-muted-foreground text-xs">
              {tr("automation.test.disclaimer")}
            </p>
          </div>
        )}
      </form>
    </section>
  );
};

export default AutomationTestPanel;
