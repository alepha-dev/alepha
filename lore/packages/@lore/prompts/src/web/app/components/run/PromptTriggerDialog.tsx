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
import {
  PROMPT_CHECKS,
  type PromptCheck,
  type PromptResource,
} from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import PromptArgSelect from "./PromptArgSelect.tsx";

export interface PromptTriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  prompt: PromptResource;
  /**
   * The row the server answered, which the page draws in place (#Q4301):
   * the server checks a trigger before taking it, so the dialog waits for
   * its answer and keeps a refused value on its field.
   */
  onSaved: (row: PromptResource) => void;
}

/**
 * A prompt's trigger (#Q4280): when it runs (the one word the CLI takes:
 * events, a schedule, or both), what it checks first, the value stored for
 * each arg the trigger does not fill, its two ceilings, and its settle
 * window (#Q4501). A refusal (an
 * arg left empty, an unknown event) lands on the `on` field.
 */
const PromptTriggerDialog = (props: PromptTriggerDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<PromptController>();
  const shape: Record<string, z.ZType> = {
    on: z.string().max(1024),
    maxRunsPerHour: z.integer().min(1).max(60),
    maxRunsPerDay: z.integer().min(1).max(1000),
    settleSeconds: z.integer().min(0).max(3600),
  };
  const initial: Record<string, unknown> = {
    on: props.prompt.on,
    maxRunsPerHour: props.prompt.maxRunsPerHour,
    maxRunsPerDay: props.prompt.maxRunsPerDay,
    settleSeconds: props.prompt.settleSeconds,
  };
  for (const check of PROMPT_CHECKS) {
    shape[`check_${check}`] = z.boolean().optional();
    initial[`check_${check}`] = props.prompt.check?.includes(check) ?? false;
  }
  for (const arg of props.prompt.args) {
    shape[`arg_${arg.name}`] = z.string().max(120).optional();
    initial[`arg_${arg.name}`] = props.prompt.argValues?.[arg.name] ?? "";
  }

  const save = useAction<[values: Record<string, unknown>], void>(
    {
      handler: async (_ctx, values) => {
        const row = await api.updatePrompt({
          params: { projectId: props.projectId, name: props.prompt.name },
          body: {
            on:
              (typeof values.on === "string" ? values.on.trim() : "") ||
              "manual",
            check: PROMPT_CHECKS.filter(
              (check) => values[`check_${check}`],
            ) as PromptCheck[],
            argValues: Object.fromEntries(
              props.prompt.args
                .map((arg) => {
                  const value = values[`arg_${arg.name}`];
                  return [arg.name, typeof value === "string" ? value : ""];
                })
                .filter(([, value]) => value),
            ),
            maxRunsPerHour: Number(values.maxRunsPerHour),
            maxRunsPerDay: Number(values.maxRunsPerDay),
            // Only when changed: an untouched field keeps following the
            // built-in's default rather than copying it onto the row.
            ...(Number(values.settleSeconds) !== props.prompt.settleSeconds
              ? { settleSeconds: Number(values.settleSeconds) }
              : {}),
          },
        });
        props.onSaved(row);
        props.onOpenChange(false);
      },
    },
    [api, props.projectId, props.prompt.name],
  );
  const form = useForm(
    {
      schema: z.object(shape) as never,
      initialValues: initial as never,
      handler: async (values: Record<string, unknown>) => {
        await save.run(values);
      },
    },
    [props.open, props.prompt.name],
  );
  const input = form.input as Record<string, never>;
  const options = useQuery(
    {
      enabled: props.open && props.prompt.args.length > 0,
      key: ["prompt-arg-options", props.projectId, props.prompt.name],
      handler: async () =>
        Object.fromEntries(
          await Promise.all(
            props.prompt.args.map(async (arg) => [
              arg.name,
              (
                await api.listPromptArgOptions({
                  params: {
                    projectId: props.projectId,
                    name: props.prompt.name,
                    arg: arg.name,
                  },
                })
              ).items,
            ]),
          ),
        ) as Record<string, Array<{ value: string; label: string }>>,
    },
    [api, props.open, props.projectId, props.prompt.name],
  );
  const busy = save.loading;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="prompt-trigger">
        <DialogHeader>
          <DialogTitle>
            {tr("prompts.trigger.title", { args: [props.prompt.title] })}
          </DialogTitle>
          <DialogDescription>
            {tr("prompts.trigger.description")}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} className="flex flex-col gap-3">
          <Control
            input={input.on}
            label={tr("prompts.trigger.on")}
            description={tr("prompts.trigger.on.description")}
            disabled={busy}
          />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {tr("prompts.trigger.check")}
            </span>
            {PROMPT_CHECKS.map((check) => (
              <Control
                key={check}
                input={input[`check_${check}`]}
                label={tr(`prompts.check.${check}`)}
                switch
                disabled={busy}
              />
            ))}
          </div>
          {props.prompt.args.map((arg) => (
            <PromptArgSelect
              key={arg.name}
              input={input[`arg_${arg.name}`]}
              label={tr("prompts.trigger.argValue", {
                args: [tr(`prompts.arg.${arg.type}`)],
              })}
              items={options.data?.[arg.name] ?? []}
              disabled={busy || options.loading}
            />
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <Control
              input={input.maxRunsPerHour}
              label={tr("prompts.trigger.perHour")}
              number
              disabled={busy}
            />
            <Control
              input={input.maxRunsPerDay}
              label={tr("prompts.trigger.perDay")}
              number
              disabled={busy}
            />
          </div>
          <Control
            input={input.settleSeconds}
            label={tr("prompts.trigger.settle")}
            description={tr("prompts.trigger.settle.description")}
            number
            disabled={busy}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
              disabled={busy}
            >
              {tr("prompts.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={busy}
              data-testid="prompt-trigger-save"
            >
              {tr("prompts.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default PromptTriggerDialog;
