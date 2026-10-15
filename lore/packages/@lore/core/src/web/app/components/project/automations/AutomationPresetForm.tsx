import {
  AutoForm,
  type ControlProps,
  type SelectOption,
} from "@alepha/ui/form";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import { automationPresetCreateSchema } from "../../../../../api/schemas/automationPresetCreateSchema.ts";
import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { AutomationPresetForms } from "../../../../../api/schemas/AutomationPresetForms.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AutomationPresetFormProps {
  preset: AutomationPresetDescriptor;
  choices: Record<string, SelectOption[]>;
  disabled?: boolean;
  onSubmit: (
    values: ReturnType<typeof automationPresetCreateSchema.shape.values.parse>,
  ) => Promise<unknown>;
  onCancel?: () => void;
}

const AutomationPresetForm = (props: AutomationPresetFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const model = useMemo(() => new AutomationPresetForms(), []);
  const schema = useMemo(
    () => model.schema(props.preset),
    [model, props.preset],
  );
  const form = useForm(
    {
      schema,
      initialValues: model.defaults(props.preset),
      handler: async (values) => {
        await props.onSubmit(
          automationPresetCreateSchema.shape.values.parse(values),
        );
      },
    },
    [schema],
  );
  const fields: Record<string, Partial<Omit<ControlProps, "input">>> = {};
  for (const [key, slot] of Object.entries(props.preset.slots)) {
    fields[key] = {
      label: tr(`automation.setup.${key}` as never, { default: key }),
    };
    if (props.choices[key] || slot.values) {
      fields[key].select = true;
      fields[key].items =
        props.choices[key] ??
        slot.values!.map((value) => ({
          value: String(value),
          label: tr(`automation.channel.${String(value)}` as never, {
            default: String(value),
          }),
        }));
    }
  }
  return (
    <div className="max-w-xl">
      <AutoForm
        form={form}
        title={tr(`automation.preset.${props.preset.key}.title` as never, {
          default: props.preset.title,
        })}
        fields={fields}
        disabled={props.disabled}
        description={tr(
          `automation.preset.${props.preset.key}.description` as never,
          { default: props.preset.description },
        )}
        submitLabel={tr("automation.preset.createDisabled")}
        onCancel={props.onCancel}
        requiredMarker={false}
      />
    </div>
  );
};

export default AutomationPresetForm;
