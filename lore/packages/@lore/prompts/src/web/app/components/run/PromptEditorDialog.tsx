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
  PROMPT_ARG_FIELDS,
  PROMPT_ARG_TYPES,
  PROMPT_MAX_ARGS,
  type PromptArg,
  type PromptResource,
} from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";

export interface PromptEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /**
   * `create` starts empty, `duplicate` from a prompt, `edit` a custom one.
   * On a built-in only the source is edited (`source`).
   */
  mode: "create" | "duplicate" | "edit" | "source";
  prompt?: PromptResource;
  /**
   * The row the server answered, which the page draws in place or inserts
   * (#Q4301): the server checks a prompt's name, args and words before
   * taking them, so the dialog waits for its answer and keeps a refused
   * value on its field.
   */
  onSaved: (row: PromptResource) => void;
}

const SLOTS = Array.from({ length: PROMPT_MAX_ARGS }, (_, index) => index);

/**
 * A custom prompt's editor (#Q4280): its name, title, description, args
 * (name, type and the statuses each accepts), its words with a legend of
 * the placeholders its args give, and its source. A built-in opens on its
 * source only: its text and args are Lore's.
 */
const PromptEditorDialog = (props: PromptEditorDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<PromptController>();
  const source = props.mode === "source";
  const edit = props.mode === "edit" || source;
  const shape: Record<string, z.ZType> = {
    name: z.string().max(64),
    title: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    text: z.string().max(131_072).optional(),
    source: z.enum(["none", "read", "write"]),
  };
  for (const slot of SLOTS) {
    shape[`arg${slot}_name`] = z.string().max(32).optional();
    shape[`arg${slot}_type`] = z.enum(PROMPT_ARG_TYPES).optional();
    shape[`arg${slot}_accepts`] = z.string().max(120).optional();
  }
  const initial: Record<string, unknown> = {
    name:
      props.mode === "duplicate"
        ? `${props.prompt?.name ?? "prompt"}-copy`.slice(0, 64)
        : (props.prompt?.name ?? ""),
    title: props.prompt?.title ?? "",
    description: props.prompt?.description ?? "",
    text: props.prompt?.text ?? "",
    source: props.prompt?.source ?? "read",
  };
  for (const slot of SLOTS) {
    const arg = props.prompt?.args[slot];
    if (arg) {
      initial[`arg${slot}_name`] = arg.name;
      initial[`arg${slot}_type`] = arg.type;
      initial[`arg${slot}_accepts`] = (arg.accepts ?? []).join(", ");
    }
  }

  const save = useAction<[values: Record<string, unknown>], void>(
    {
      handler: async (_ctx, values) => {
        const text = (key: string) => {
          const value = values[key];
          return typeof value === "string" && value.trim()
            ? value.trim()
            : undefined;
        };
        if (source && props.prompt) {
          props.onSaved(
            await api.updatePrompt({
              params: { projectId: props.projectId, name: props.prompt.name },
              body: { source: values.source as PromptResource["source"] },
            }),
          );
          props.onOpenChange(false);
          return;
        }
        const args: PromptArg[] = [];
        for (const slot of SLOTS) {
          const name = text(`arg${slot}_name`);
          const type = values[`arg${slot}_type`] as PromptArg["type"];
          if (!name || !type) continue;
          const accepts = (text(`arg${slot}_accepts`) ?? "")
            .split(",")
            .map((it) => it.trim())
            .filter(Boolean);
          args.push({ name, type, ...(accepts.length ? { accepts } : {}) });
        }
        const body = {
          ...(text("title") ? { title: text("title") } : {}),
          description: text("description") ?? "",
          text: text("text") ?? "",
          args,
          source: values.source as PromptResource["source"],
        };
        props.onSaved(
          edit && props.prompt
            ? await api.updatePrompt({
                params: { projectId: props.projectId, name: props.prompt.name },
                body,
              })
            : await api.createPrompt({
                params: { projectId: props.projectId },
                body: { ...body, name: text("name") ?? "" },
              }),
        );
        props.onOpenChange(false);
      },
    },
    [api, props.projectId, props.prompt?.name, props.mode],
  );

  const form = useForm(
    {
      schema: z.object(shape) as never,
      initialValues: initial as never,
      handler: async (values: Record<string, unknown>) => {
        await save.run(values);
      },
    },
    [props.open, props.prompt?.name, props.mode],
  );
  const values = useFormValues(form) as Record<string, unknown>;
  const input = form.input as Record<string, never>;
  const busy = save.loading;
  const legend = [
    "{{project}}",
    "{{slug}}",
    "{{projectUrl}}",
    ...SLOTS.flatMap((slot) => {
      const name = values[`arg${slot}_name`];
      const type = values[`arg${slot}_type`] as PromptArg["type"] | undefined;
      return typeof name === "string" && name && type
        ? PROMPT_ARG_FIELDS[type].map((field) => `{{${name}.${field}}}`)
        : [];
    }),
  ];

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="prompt-editor">
        <DialogHeader>
          <DialogTitle>
            {tr(`prompts.editor.${props.mode}`, {
              args: [props.prompt?.title ?? ""],
            })}
          </DialogTitle>
          <DialogDescription>
            {source
              ? tr("prompts.editor.source.description")
              : tr("prompts.editor.description")}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} className="flex flex-col gap-3">
          {!source && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Control
                input={input.name}
                label={tr("prompts.editor.name")}
                description={tr("prompts.editor.name.description")}
                disabled={busy || edit}
              />
              <Control
                input={input.title}
                label={tr("prompts.editor.title")}
                disabled={busy}
              />
            </div>
          )}
          {!source && (
            <Control
              input={input.description}
              label={tr("prompts.editor.descriptionField")}
              disabled={busy}
            />
          )}
          <Control
            input={input.source}
            label={tr("prompts.source")}
            description={tr("prompts.source.description")}
            select
            items={[
              { value: "none", label: tr("prompts.source.none") },
              { value: "read", label: tr("prompts.source.read") },
              { value: "write", label: tr("prompts.source.write") },
            ]}
            disabled={busy}
          />
          {!source &&
            SLOTS.map((slot) => (
              <div key={slot} className="grid gap-3 sm:grid-cols-3">
                <Control
                  input={input[`arg${slot}_name`]}
                  label={tr("prompts.editor.argName", {
                    args: [String(slot + 1)],
                  })}
                  disabled={busy}
                />
                <Control
                  input={input[`arg${slot}_type`]}
                  label={tr("prompts.editor.argType")}
                  select
                  items={PROMPT_ARG_TYPES.map((type) => ({
                    value: type,
                    label: tr(`prompts.arg.${type}`),
                  }))}
                  disabled={busy}
                />
                <Control
                  input={input[`arg${slot}_accepts`]}
                  label={tr("prompts.editor.argAccepts")}
                  disabled={busy}
                />
              </div>
            ))}
          {!source && (
            <>
              <Control
                input={input.text}
                label={tr("prompts.editor.text")}
                area
                disabled={busy}
              />
              <p
                className="text-muted-foreground text-xs"
                data-testid="prompt-legend"
              >
                {tr("prompts.editor.legend", { args: [legend.join(" ")] })}
              </p>
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
              disabled={busy}
            >
              {tr("prompts.cancel")}
            </Button>
            <Button type="submit" disabled={busy} data-testid="prompt-save">
              {tr("prompts.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default PromptEditorDialog;
