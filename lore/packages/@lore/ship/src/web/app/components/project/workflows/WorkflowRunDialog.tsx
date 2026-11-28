import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { WorkflowController } from "../../../../../api/controllers/WorkflowController.ts";
import type { Workflow } from "../../../../../api/schemas/workflowSchema.ts";

export interface WorkflowRunDialogProps {
  onOpenChange: (open: boolean) => void;
  projectId: number;
  workflow: Workflow;
  defaultBranch?: string;
  /**
   * Called once GitHub accepted the dispatch, so the page polls for the run.
   */
  onStarted?: () => void;
}

/**
 * Starts a workflow (#Q4366): the branch or tag, then one field per input
 * the workflow declares (a select for a choice, a switch for a boolean, a
 * text field otherwise), prefilled with its default. Mounted only while
 * open, so the form's schema is this workflow's.
 */
const WorkflowRunDialog = (props: WorkflowRunDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<WorkflowController>();
  const queries = useQueryClient();
  const inputs = props.workflow.inputs;

  const form = useForm({
    id: `workflow-run-${props.workflow.id}`,
    schema: z.object({
      ref: z.string().min(1).max(255),
      ...Object.fromEntries(
        inputs.map((input) => [
          input.name,
          input.type === "boolean"
            ? z.boolean().optional()
            : input.required && input.default === undefined
              ? z.string().min(1).max(255)
              : z.string().max(255).optional(),
        ]),
      ),
    }),
    initialValues: {
      ref: props.defaultBranch ?? "",
      ...Object.fromEntries(
        inputs.map((input) => [
          input.name,
          input.type === "boolean"
            ? input.default === "true"
            : (input.default ?? ""),
        ]),
      ),
    },
    handler: async (values: Record<string, unknown>) => {
      const given: Record<string, string> = {};
      for (const input of inputs) {
        const value = values[input.name];
        if (typeof value === "boolean") given[input.name] = String(value);
        else if (typeof value === "string" && value !== "") {
          given[input.name] = value;
        }
      }
      await api.dispatchWorkflow({
        params: { projectId: props.projectId },
        body: {
          workflowId: props.workflow.id,
          ref: String(values.ref).trim(),
          ...(Object.keys(given).length ? { inputs: given } : {}),
        },
      });
      queries.invalidate(["workflows", props.projectId]);
      toaster.success(tr("workflows.started"));
      props.onStarted?.();
      props.onOpenChange(false);
    },
  });
  const { loading } = useFormState(form, ["loading"]);
  // One field per declared input: the keys are the workflow's, not the
  // schema's literal ones.
  const fields = form.input as Record<string, any>;

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent data-testid="workflow-run-dialog">
        <DialogHeader>
          <DialogTitle>
            {tr("workflows.run.title", { args: [props.workflow.name] })}
          </DialogTitle>
          <DialogDescription>{props.workflow.path}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <div data-testid="workflow-run-ref">
            <Control input={fields.ref} label={tr("workflows.run.ref")} />
          </div>
          {inputs.map((input) => (
            <div key={input.name} data-testid={`workflow-input-${input.name}`}>
              {input.type === "choice" && input.options?.length ? (
                <Control
                  select
                  input={fields[input.name]}
                  label={input.name}
                  description={input.description}
                  items={input.options.map((option) => ({
                    value: option,
                    label: option,
                  }))}
                />
              ) : (
                <Control
                  input={fields[input.name]}
                  label={input.name}
                  description={input.description}
                />
              )}
            </div>
          ))}
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("workflows.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={loading}
              data-testid="workflow-run-submit"
            >
              {tr("workflows.run")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default WorkflowRunDialog;
