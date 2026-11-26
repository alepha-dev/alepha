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
import { AGENT_MODELS, type PromptResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useEffect } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import type { PromptHostAgent } from "../../../../api/schemas/promptHostAgentSchema.ts";
import PromptArgSelect from "./PromptArgSelect.tsx";

export interface PromptRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  prompt: PromptResource;
  /**
   * `copy` renders the text; `run` starts a job, and asks the host.
   */
  mode: "copy" | "run";
  /**
   * The args the page or the row already gave: not asked again.
   */
  given?: Record<string, string>;
  /**
   * The Agent hosts a run may pick; Run is offered only with one.
   */
  hosts?: string[];
  /**
   * Each host's agent CLIs and whether each is signed in (#Q4504): the
   * Model select lists the models of the chosen host's signed-in ones.
   */
  agents?: PromptHostAgent[];
  busy?: boolean;
  onSubmit: (body: {
    args: Record<string, string>;
    host?: string;
    agent?: string;
    model?: string;
    fix?: boolean;
    trust?: boolean;
  }) => void;
}

/**
 * Copy or Run a prompt (#Q4280): one select per arg the page did not give,
 * listing only the items whose status the arg accepts (never free text),
 * and, for a run, the Agent host and, when the host has a signed-in agent
 * CLI with a known list (`AGENT_MODELS`), its model (#Q4504). Empty, a run
 * takes the host's first agent CLI and its default model; a model picked
 * names its agent CLI too. The source is the prompt's. `review-pr` adds
 * its fix and trust options. Shared with the pinned button and the
 * spotlight (#Q4284).
 *
 * A member arg starts on the signed-in member (#Q4294), which is what the
 * server takes for a member left out, so the default is visible and one
 * click runs it. Only once the options say they are a member: a privileged
 * identity outside the project keeps an empty select.
 */
const PromptRunDialog = (props: PromptRunDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<PromptController>();
  const me = useAuth().user?.id;
  const missing = props.prompt.args.filter((arg) => !props.given?.[arg.name]);
  const shape: Record<string, z.ZType> = {
    host: z.text({ maxLength: 64 }).optional(),
    model: z.text({ maxLength: 120 }).optional(),
    fix: z.boolean().optional(),
    trust: z.boolean().optional(),
  };
  for (const arg of missing) {
    shape[`arg_${arg.name}`] =
      arg.type === "member"
        ? z.text({ maxLength: 120 }).optional()
        : z.text({ maxLength: 120 });
  }
  const form = useForm(
    {
      schema: z.object(shape) as never,
      initialValues: (props.hosts?.length
        ? { host: props.hosts[0] }
        : {}) as never,
      handler: async (values: Record<string, unknown>) => {
        const args: Record<string, string> = { ...props.given };
        for (const arg of missing) {
          const value = values[`arg_${arg.name}`];
          if (typeof value === "string" && value) args[arg.name] = value;
        }
        // `<agent>|<model>`, one of the chosen host's (#Q4504).
        const [agent, model] =
          props.mode === "run" && typeof values.model === "string"
            ? values.model.split("|")
            : [];
        props.onSubmit({
          args,
          ...(props.mode === "run" &&
          typeof values.host === "string" &&
          values.host
            ? { host: values.host }
            : {}),
          ...(agent && model ? { agent, model } : {}),
          ...(values.fix ? { fix: true } : {}),
          ...(values.trust ? { trust: true } : {}),
        });
      },
    },
    [props.open, props.prompt.name],
  );
  const input = form.input as Record<string, never>;
  const values = useFormValues(form) as Record<string, unknown>;
  // The models of the chosen host's agent CLIs that are signed in, or say
  // nothing of it (#Q4504): a CLI signed out offers none.
  const chosenHost =
    typeof values.host === "string" && values.host
      ? values.host
      : props.hosts?.[0];
  const models = (props.agents ?? [])
    .filter((it) => it.host === chosenHost && it.signedIn !== false)
    .flatMap((it) =>
      (AGENT_MODELS[it.agent] ?? []).map((choice) => ({
        value: `${it.agent}|${choice.model}`,
        label: choice.alias,
      })),
    );
  // The select follows the host: a model the new host does not offer goes.
  const picked = typeof values.model === "string" ? values.model : "";
  useEffect(() => {
    if (picked && !models.some((it) => it.value === picked)) {
      form.setInitialValues(
        { ...form.currentValues, model: "" },
        { keepDirty: true },
      );
    }
  }, [chosenHost, picked]);
  // The options of every missing arg, read once the dialog opens.
  const options = useQuery(
    {
      enabled: props.open && missing.length > 0,
      key: ["prompt-arg-options", props.projectId, props.prompt.name],
      handler: async () =>
        Object.fromEntries(
          await Promise.all(
            missing.map(async (arg) => [
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

  // Once the options are in, a member arg nobody picked yet starts on the
  // signed-in member, and every other field keeps what it holds.
  useEffect(() => {
    if (!me || !options.data) return;
    const values: Record<string, unknown> = { ...form.currentValues };
    let changed = false;
    for (const arg of missing) {
      const key = `arg_${arg.name}`;
      if (arg.type !== "member" || values[key]) continue;
      if (!options.data[arg.name]?.some((it) => it.value === me)) continue;
      values[key] = me;
      changed = true;
    }
    if (changed) form.setInitialValues(values, { keepDirty: true });
  }, [form, me, options.data]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="prompt-run-dialog">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "run"
              ? tr("prompts.run.title", { args: [props.prompt.title] })
              : tr("prompts.copy.title", { args: [props.prompt.title] })}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "run"
              ? tr("prompts.run.description")
              : tr("prompts.copy.description")}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} className="flex flex-col gap-3">
          {missing.map((arg) => (
            <PromptArgSelect
              key={arg.name}
              input={input[`arg_${arg.name}`]}
              label={tr(`prompts.arg.${arg.type}`)}
              items={options.data?.[arg.name] ?? []}
              disabled={props.busy || options.loading}
            />
          ))}
          {props.mode === "run" && (
            <Control
              input={input.host}
              label={tr("prompts.run.host")}
              select
              items={(props.hosts ?? []).map((host) => ({
                value: host,
                label: host,
              }))}
              disabled={props.busy}
            />
          )}
          {props.mode === "run" && models.length > 0 && (
            <Control
              input={input.model}
              label={tr("prompts.run.model")}
              select
              clearable
              clearLabel={tr("prompts.run.model.default")}
              items={models}
              disabled={props.busy}
              data-testid="prompt-run-model"
            />
          )}
          {props.mode === "run" && props.prompt.name === "review-pr" && (
            <>
              <Control
                input={input.fix}
                label={tr("prompts.run.fix")}
                switch
                disabled={props.busy}
              />
              <Control
                input={input.trust}
                label={tr("prompts.run.trust")}
                switch
                disabled={props.busy}
              />
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
              disabled={props.busy}
            >
              {tr("prompts.cancel")}
            </Button>
            <Button
              type="submit"
              // The kit's spinner while the run (or the copy) is in flight
              // (#Q4505): starting a job takes seconds, and a still button
              // read as broken.
              loading={props.busy}
              data-testid="prompt-run-submit"
            >
              {props.mode === "run" ? tr("prompts.run") : tr("prompts.copy")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default PromptRunDialog;
