import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { automationEditorValueSchema } from "../../../../../api/schemas/automationEditorValueSchema.ts";
import type { AutomationSlotKind } from "../../../../../api/schemas/automationSlotKindSchema.ts";
import type { AutomationSlot } from "../../../../../api/schemas/automationSlotSchema.ts";
import { AutomationTemplateTokens } from "../../../../../api/schemas/AutomationTemplateTokens.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useAutomationSetupChoices } from "./useAutomationSetupChoices.ts";

export interface AutomationValueControlProps {
  label: string;
  slot: AutomationSlot;
  value: unknown;
  bindings?: { key: string; kind: AutomationSlotKind }[];
  channels?: string[];
  disabled: boolean;
  onChange: (value: unknown) => void;
}

const AutomationValueControl = (props: AutomationValueControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const resource = props.slot.resource ?? props.slot.kind;
  const choices = useAutomationSetupChoices(
    (["member", "folio", "release", "quest", "app"].includes(resource)
      ? resource
      : "quest") as "member" | "folio" | "release" | "quest" | "app",
    ["member", "folio", "release", "quest", "app"].includes(resource),
  );
  const bindingKey =
    typeof props.value === "string"
      ? new AutomationTemplateTokens().whole(props.value)
      : undefined;
  const bound = bindingKey !== undefined;
  const form = useForm({
    schema: automationEditorValueSchema,
    handler: () => undefined,
    initialValues: {
      mode: bound ? "binding" : "literal",
      text: Array.isArray(props.value)
        ? props.value.join("\n")
        : typeof props.value === "string" && !bound
          ? props.value
          : "",
      number: typeof props.value === "number" ? props.value : undefined,
      boolean: typeof props.value === "boolean" ? props.value : false,
      binding: bindingKey ?? "",
    },
    onChange: (name, value, values) => {
      const state = { ...values, [name]: value };
      if (state.mode === "binding")
        props.onChange(state.binding ? `{{${state.binding}}}` : "");
      else if (props.slot.kind === "boolean") props.onChange(state.boolean);
      else if (
        ["number", "release"].includes(props.slot.kind) ||
        resource === "quest"
      )
        props.onChange(state.number);
      else if (props.slot.kind === "textArray")
        props.onChange(
          String(state.text ?? "")
            .split("\n")
            .filter(Boolean),
        );
      else props.onChange(state.text || (props.slot.required ? "" : undefined));
    },
  });
  const values = useFormValues(form);
  const numeric =
    ["number", "release"].includes(props.slot.kind) || resource === "quest";
  const availableBindings = (props.bindings ?? []).filter(
    (binding) =>
      binding.kind === props.slot.kind ||
      (props.slot.template && props.slot.kind === "text"),
  );
  if (
    bound &&
    !availableBindings.some((binding) => binding.key === bindingKey!)
  )
    availableBindings.push({
      key: bindingKey!,
      kind: props.slot.kind,
    });
  const options =
    props.slot.values?.map((value) => ({
      value: String(value),
      label: String(value),
    })) ??
    (resource === "channel"
      ? props.channels?.map((value) => ({ value, label: value }))
      : ["member", "folio", "release", "quest", "app"].includes(resource)
        ? choices.items
        : []);
  const isPicker =
    !!options?.length ||
    ["member", "folio", "release", "quest", "app", "channel"].includes(
      resource,
    );
  return (
    <div className="flex flex-col gap-2">
      {props.slot.bindable !== false && availableBindings.length > 0 && (
        <Control
          input={form.input.mode}
          label={`${props.label}: ${tr("automation.editor.valueSource")}`}
          select
          items={[
            { value: "literal", label: tr("automation.sharing.literal") },
            { value: "binding", label: tr("automation.editor.binding") },
          ]}
          disabled={props.disabled}
        />
      )}
      {values.mode === "binding" ? (
        <Control
          input={form.input.binding}
          label={props.label}
          select
          items={availableBindings.map((binding) => ({
            value: binding.key,
            label: `{{${binding.key}}}`,
          }))}
          disabled={props.disabled}
        />
      ) : (
        <Control
          input={
            props.slot.kind === "boolean"
              ? form.input.boolean
              : numeric
                ? form.input.number
                : form.input.text
          }
          label={props.label}
          disabled={props.disabled}
          {...(isPicker
            ? { select: true, items: options ?? [] }
            : props.slot.template || props.slot.kind === "textArray"
              ? { area: true }
              : {})}
        />
      )}
      {values.mode !== "binding" && choices.navigation.hasMore && (
        <Button
          variant="minimal"
          size="sm"
          disabled={props.disabled || choices.navigation.loading}
          onClick={choices.navigation.next}
        >
          {tr("automation.next")}
        </Button>
      )}
      {values.mode !== "binding" && choices.navigation.offset > 0 && (
        <Button
          variant="minimal"
          size="sm"
          disabled={props.disabled || choices.navigation.loading}
          onClick={choices.navigation.previous}
        >
          {tr("automation.previous")}
        </Button>
      )}
      {props.slot.template && (
        <p className="text-muted-foreground text-xs break-words">
          {tr("automation.editor.templates")}{" "}
          {availableBindings.map((binding) => `{{${binding.key}}}`).join(", ")}
        </p>
      )}
    </div>
  );
};
export default AutomationValueControl;
