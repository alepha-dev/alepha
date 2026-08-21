import { WorkflowStatusBadge } from "@alepha/ui/components/admin/admin-workflows-status-badge";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import type { AdminWorkflowController } from "alepha/api/workflows";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban, Play, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";

export interface WorkflowExecutionSheetProps {
  executionId: string | null;
  onClose: () => void;
}

/**
 * Detail sheet for one workflow execution: status, admin actions gated by
 * the server-computed `can`, and the step timeline with per-step attempts,
 * durations, errors and results.
 */
export const WorkflowExecutionSheet = (props: WorkflowExecutionSheetProps) => {
  const client = useClient<AdminWorkflowController>();
  const { l, tr } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: detail } = useQuery(
    {
      handler: ({ signal }) =>
        props.executionId
          ? client.getWorkflowExecution(
              { params: { id: props.executionId } },
              { request: { signal } },
            )
          : Promise.resolve(null),
      onError: () => {},
    },
    [client, props.executionId, refreshKey],
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  const retry = useConfirmedAction<[string]>(
    {
      confirm: {
        title: tr("admin.workflows.retryTitle", { default: "Retry workflow" }),
        description: tr("admin.workflows.retryConfirm", {
          default: "Resume this execution from its failed step?",
        }),
      },
      handler: async (id) => {
        await client.retryWorkflowExecution({ params: { id } });
        refresh();
      },
      success: tr("admin.workflows.retried", { default: "Workflow resumed" }),
    },
    [client, tr],
  );

  const cancel = useConfirmedAction<[string]>(
    {
      confirm: {
        title: tr("admin.workflows.cancelTitle", {
          default: "Cancel workflow",
        }),
        description: tr("admin.workflows.cancelConfirm", {
          default: "Stop this execution? Remaining steps will not run.",
        }),
        destructive: true,
      },
      handler: async (id) => {
        await client.cancelWorkflowExecution({ params: { id } });
        refresh();
      },
      success: tr("admin.workflows.cancelled", {
        default: "Workflow cancelled",
      }),
    },
    [client, tr],
  );

  const compensate = useConfirmedAction<[string]>(
    {
      confirm: {
        title: tr("admin.workflows.compensateTitle", {
          default: "Compensate workflow",
        }),
        description: tr("admin.workflows.compensateConfirm", {
          default:
            "Run the compensation functions of every completed step, in reverse order?",
        }),
        destructive: true,
      },
      handler: async (id) => {
        await client.compensateWorkflowExecution({ params: { id } });
        refresh();
      },
      success: tr("admin.workflows.compensated", {
        default: "Compensation started",
      }),
    },
    [client, tr],
  );

  const restart = useConfirmedAction<[string]>(
    {
      confirm: {
        title: tr("admin.workflows.restartTitle", {
          default: "Restart workflow",
        }),
        description: tr("admin.workflows.restartConfirm", {
          default: "Start a new execution with the same payload?",
        }),
      },
      handler: async (id) => {
        await client.restartWorkflowExecution({ params: { id } });
        refresh();
      },
      success: tr("admin.workflows.restarted", {
        default: "Workflow restarted",
      }),
    },
    [client, tr],
  );

  return (
    <Sheet
      open={props.executionId !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 data-[side=right]:sm:max-w-[42vw]"
      >
        {detail && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="truncate">{detail.workflowName}</span>
                <WorkflowStatusBadge status={detail.status} />
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {detail.id}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
              {detail.can.retry && (
                <Button size="sm" onClick={() => retry.run(detail.id)}>
                  <Play />
                  {tr("admin.workflows.retry", { default: "Retry" })}
                </Button>
              )}
              {detail.can.restart && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => restart.run(detail.id)}
                >
                  <RotateCcw />
                  {tr("admin.workflows.restart", { default: "Restart" })}
                </Button>
              )}
              {detail.can.compensate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => compensate.run(detail.id)}
                >
                  <Undo2 />
                  {tr("admin.workflows.compensate", { default: "Compensate" })}
                </Button>
              )}
              {detail.can.cancel && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => cancel.run(detail.id)}
                >
                  <Ban />
                  {tr("admin.workflows.cancel", { default: "Cancel" })}
                </Button>
              )}
            </div>

            {detail.error && (
              <div className="text-destructive border-destructive/30 bg-destructive/5 mx-4 mb-2 rounded-md border px-3 py-2 text-xs">
                <span className="font-medium">
                  {detail.errorStep ? `${detail.errorStep}: ` : null}
                </span>
                {detail.error}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <ol className="flex flex-col gap-2">
                {detail.steps.map((step) => (
                  <WorkflowExecutionSheetStep key={step.id} step={step} l={l} />
                ))}
              </ol>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

interface WorkflowExecutionSheetStepProps {
  step: {
    id: string;
    stepName: string;
    stepIndex: number;
    status: string;
    attempt: number;
    maxAttempts: number;
    iteration?: number;
    error?: string;
    result?: Record<string, unknown>;
    startedAt?: string;
    completedAt?: string;
    scheduledAt?: string;
  };
  l: ReturnType<typeof useI18n>["l"];
}

const WorkflowExecutionSheetStep = (props: WorkflowExecutionSheetStepProps) => {
  const { step, l } = props;
  const durationMs =
    step.startedAt && step.completedAt
      ? new Date(step.completedAt).getTime() -
        new Date(step.startedAt).getTime()
      : null;

  return (
    <li className="rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-5 text-right font-mono text-xs">
          {step.stepIndex + 1}
        </span>
        <span className="truncate text-sm font-medium">{step.stepName}</span>
        <WorkflowStatusBadge status={step.status} />
        <span className="text-muted-foreground ml-auto text-xs">
          {step.iteration && step.iteration > 0
            ? `×${step.iteration + 1} `
            : null}
          {step.attempt > 0 ? `${step.attempt}/${step.maxAttempts}` : null}
          {durationMs !== null
            ? ` · ${durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`}`
            : null}
        </span>
      </div>
      {step.status === "pending" && step.scheduledAt && (
        <div className="text-muted-foreground mt-1 pl-7 text-xs">
          {String(l(step.scheduledAt, { date: "fromNow" }))}
        </div>
      )}
      {step.error && (
        <div className="text-destructive mt-1 pl-7 text-xs" title={step.error}>
          {step.error}
        </div>
      )}
      {step.result && (
        <pre className="text-muted-foreground bg-muted/50 mt-1 max-h-32 overflow-auto rounded p-2 pl-2 text-[11px] leading-snug">
          {JSON.stringify(step.result, null, 2)}
        </pre>
      )}
    </li>
  );
};
