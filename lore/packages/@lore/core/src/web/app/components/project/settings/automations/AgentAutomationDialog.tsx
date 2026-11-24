import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { AgentAutomationController } from "../../../../../../api/controllers/AgentAutomationController.ts";
import {
  type AgentAutomationForm,
  agentAutomationFormSchema,
} from "../../../../../../api/schemas/agentAutomationFormSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface AgentAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /**
   * The read the table draws from, refreshed once the row is saved.
   */
  invalidates: unknown[];
}

/**
 * New automation (#Q4231): the create action's fields in a small form. The
 * trigger is the one word the CLI takes (`manual`, `event:<key>`, `hourly`,
 * `6h`, `daily@<utc-hour>`), so the page teaches what the command line
 * does. Editing happens from the CLI or MCP; the table switches one on or
 * off.
 */
const AgentAutomationDialog = (props: AgentAutomationDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<AgentAutomationController>();

  const save = useAction<[values: AgentAutomationForm], void>(
    {
      handler: async (_ctx, values) => {
        const text = (value?: string) => value?.trim() || undefined;
        await api.createProjectAutomation({
          params: { projectId: props.projectId },
          body: {
            name: values.name,
            promptKind: values.promptKind,
            ...(values.promptKind === "text" && text(values.promptText)
              ? { promptText: text(values.promptText) }
              : {}),
            ...(text(values.host) ? { host: text(values.host) } : {}),
            ...(text(values.agent) ? { agent: text(values.agent) } : {}),
            ...(text(values.model) ? { model: text(values.model) } : {}),
            ...(text(values.on) ? { on: text(values.on) } : {}),
            ...(values.promptKind === "text"
              ? {}
              : { onlyIfWork: values.onlyIfWork ?? false }),
            ...(values.promptKind === "build"
              ? {
                  autoMerge: values.autoMerge ?? false,
                  concurrency: values.concurrency ?? 1,
                }
              : {}),
          },
        });
        props.onOpenChange(false);
      },
      invalidates: [props.invalidates],
    },
    [api, props.projectId, props.onOpenChange],
  );

  // Rebuilt each time the dialog opens: `useForm` anchors its values at
  // mount.
  const form = useForm(
    {
      schema: agentAutomationFormSchema,
      initialValues: {
        name: "",
        promptKind: "triage",
        on: "manual",
        onlyIfWork: false,
        autoMerge: false,
        concurrency: 1,
      },
      handler: async (values) => {
        await save.run(values);
      },
    },
    [props.open],
  );
  const values = useFormValues(form);
  const busy = save.loading;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("automations.add")}</DialogTitle>
          <DialogDescription>
            {tr("automations.add.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          className="flex flex-col gap-3"
          data-testid="automation-form"
        >
          <Control
            input={form.input.name}
            label={tr("automations.form.name")}
            description={tr("automations.form.name.description")}
            disabled={busy}
          />
          <Control
            input={form.input.promptKind}
            label={tr("automations.form.prompt")}
            select
            items={[
              { value: "triage", label: tr("automations.prompt.triage") },
              { value: "build", label: tr("automations.prompt.build") },
              { value: "text", label: tr("automations.prompt.text") },
            ]}
            disabled={busy}
          />
          {values.promptKind === "text" && (
            <Control
              input={form.input.promptText}
              label={tr("automations.form.text")}
              area
              disabled={busy}
            />
          )}
          <Control
            input={form.input.on}
            label={tr("automations.form.on")}
            description={tr("automations.form.on.description")}
            disabled={busy}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Control
              input={form.input.host}
              label={tr("automations.form.host")}
              disabled={busy}
            />
            <Control
              input={form.input.agent}
              label={tr("automations.form.agent")}
              disabled={busy}
            />
            <Control
              input={form.input.model}
              label={tr("automations.form.model")}
              disabled={busy}
            />
          </div>
          {values.promptKind !== "text" && (
            <Control
              input={form.input.onlyIfWork}
              label={tr("automations.form.onlyIfWork")}
              switch
              disabled={busy}
            />
          )}
          {values.promptKind === "build" && (
            <>
              <Control
                input={form.input.autoMerge}
                label={tr("automations.form.autoMerge")}
                switch
                disabled={busy}
              />
              <Control
                input={form.input.concurrency}
                label={tr("automations.form.concurrency")}
                description={tr("automations.form.concurrency.description")}
                number
                disabled={busy}
              />
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
              disabled={busy}
            >
              {tr("automations.form.cancel")}
            </Button>
            <Button type="submit" disabled={busy} data-testid="automation-save">
              {tr("automations.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AgentAutomationDialog;
