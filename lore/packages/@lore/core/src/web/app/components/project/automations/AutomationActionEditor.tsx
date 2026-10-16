import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { automationActionKindFormSchema } from "../../../../../api/schemas/automationActionKindFormSchema.ts";
import { automationAudienceFormSchema } from "../../../../../api/schemas/automationAudienceFormSchema.ts";
import type { AutomationDescriptor } from "../../../../../api/schemas/automationDescriptorSchema.ts";
import type { AutomationRule } from "../../../../../api/schemas/automationRuleSchema.ts";
import type { AutomationSlotKind } from "../../../../../api/schemas/automationSlotKindSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationValueControl from "./AutomationValueControl.tsx";

export interface AutomationActionEditorProps {
  index: number;
  action: AutomationRule["actions"][number];
  entries: AutomationDescriptor[];
  bindings: { key: string; kind: AutomationSlotKind }[];
  channels: string[];
  disabled: boolean;
  removable: boolean;
  allowAudience: boolean;
  onKind: (kind: string) => void;
  onChange: (key: string, value: unknown) => void;
  onRemove: () => void;
}
const AutomationActionEditor = (props: AutomationActionEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const form = useForm({
    schema: automationActionKindFormSchema,
    handler: () => undefined,
    initialValues: { kind: props.action.kind },
    onChange: (_name, value) => props.onKind(String(value)),
  });
  const audienceForm = useForm({
    schema: automationAudienceFormSchema,
    initialValues: {
      audience:
        props.action.kind === "notify" && props.action.audience
          ? "roster"
          : "member",
    },
    handler: () => undefined,
    onChange: (_key, value) =>
      props.onChange(
        "audience",
        value === "roster" ? "projectMembersExceptPublisher" : undefined,
      ),
  });
  const entry = props.entries.find((item) => item.key === props.action.kind);
  return (
    <div className="bg-card flex flex-col gap-3 rounded-lg border p-4">
      <Control
        input={form.input.kind}
        label={tr("automation.editor.action", {
          args: [String(props.index + 1)],
        })}
        select
        items={props.entries.map((item) => ({
          value: item.key,
          label: tr(`automation.action.${item.key}` as never, {
            default: item.key,
          }),
        }))}
        disabled={props.disabled}
      />
      {props.action.kind === "notify" && props.allowAudience && (
        <Control
          input={audienceForm.input.audience}
          label={tr("automation.adoption.recipients")}
          select
          items={[
            { value: "member", label: tr("automation.adoption.member") },
            { value: "roster", label: tr("automation.adoption.roster") },
          ]}
          disabled={props.disabled}
        />
      )}
      {Object.entries(entry?.slots ?? {})
        .filter(
          ([key]) =>
            key !== "audience" &&
            !(
              key === "recipient" &&
              props.action.kind === "notify" &&
              props.action.audience
            ),
        )
        .map(([key, slot]) => (
          <AutomationValueControl
            key={`${entry?.key}:${key}`}
            label={tr(`automation.setup.${key}` as never, { default: key })}
            slot={slot}
            value={(props.action as unknown as Record<string, unknown>)[key]}
            bindings={props.bindings}
            channels={props.channels}
            disabled={props.disabled}
            onChange={(value) => props.onChange(key, value)}
          />
        ))}
      {props.removable && (
        <Button
          variant="minimal"
          intent="danger"
          className="self-start"
          disabled={props.disabled}
          onClick={props.onRemove}
        >
          {tr("automation.editor.removeAction")}
        </Button>
      )}
    </div>
  );
};
export default AutomationActionEditor;
