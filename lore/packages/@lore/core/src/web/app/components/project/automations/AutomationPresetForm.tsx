import { Button } from "@alepha/ui";
import { Control, type SelectOption } from "@alepha/ui/form";
import {
  FormValidationError,
  useForm,
  useFormState,
  useFormValues,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useRef } from "react";

import { automationFilterValueSchema } from "../../../../../api/schemas/automationFilterValueSchema.ts";
import { automationPresetCreateSchema } from "../../../../../api/schemas/automationPresetCreateSchema.ts";
import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { AutomationPresetForms } from "../../../../../api/schemas/AutomationPresetForms.ts";
import type { AutomationVariableApproval } from "../../../../../api/schemas/automationVariableApprovalSchema.ts";
import {
  automationVariableResourceSchema,
  type AutomationVariableResource,
} from "../../../../../api/schemas/automationVariableResourceSchema.ts";
import {
  automationVariableValueSchema,
  type AutomationVariableValue,
} from "../../../../../api/schemas/automationVariableValueSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AutomationPresetFormProps {
  preset: AutomationPresetDescriptor;
  choices: Record<string, SelectOption[]>;
  choiceNavigation?: Record<
    string,
    {
      hasMore: boolean;
      offset: number;
      loading: boolean;
      previous: () => void;
      next: () => void;
    }
  >;
  variables?: AutomationVariableResource[];
  variableNavigation?: {
    hasMore: boolean;
    offset: number;
    loading: boolean;
    previous: () => void;
    next: () => void;
  };
  canManageVariables?: boolean;
  disabled?: boolean;
  onSubmit: (
    values: ReturnType<typeof automationPresetCreateSchema.shape.values.parse>,
    bindings: Record<string, AutomationVariableApproval>,
    labels: Record<string, string>,
  ) => Promise<unknown>;
  // The form handler awaits this callback, preserving rejection and form state.
  onCreateShared?: (
    key: string,
    value: AutomationVariableValue,
  ) => Promise<AutomationVariableResource>;
  onCancel?: () => void;
}

const AutomationPresetForm = (props: AutomationPresetFormProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const selectedLabels = useRef<Record<string, string>>({});
  const model = useMemo(() => new AutomationPresetForms(), []);
  const literalSchema = useMemo(
    () => model.schema(props.preset),
    [model, props.preset],
  );
  const schema = useMemo(
    () => model.authoringSchema(props.preset),
    [model, props.preset],
  );
  const form = useForm(
    {
      schema,
      initialValues: model.defaults(props.preset),
      onChange: (name, value) => {
        const choice = props.choices[name]?.find(
          (option) =>
            (typeof option === "string" ? option : option.value) === value,
        );
        if (choice)
          selectedLabels.current[name] =
            typeof choice === "string" ? choice : choice.label;
        if (name.startsWith("mode_")) {
          const slotName = name.slice("mode_".length);
          if (value === "shared") {
            form.input[`local_${slotName}`].set(form.currentValues[slotName]);
            form.input[slotName].set(undefined);
          } else if (form.currentValues[slotName] === undefined) {
            form.input[slotName].set(
              form.currentValues[`local_${slotName}`] ??
                props.preset.slots[slotName].default,
            );
          }
        }
        if (!name.startsWith("shared_")) return;
        const slotName = name.slice("shared_".length);
        const variable = props.variables?.find(
          (variable) => variable.id === value,
        );
        form.input[`binding_${slotName}`].set(variable);
      },
      handler: async (raw) => {
        const issue = model.validateAuthoring(props.preset, raw, {
          invalidValue: tr("automation.setup.invalidValue"),
          sharedRequired: tr("automation.sharing.chooseVariable"),
          keyRequired: tr("automation.sharing.validKey"),
        });
        if (issue) throw new FormValidationError(issue);
        const values: ReturnType<
          typeof automationPresetCreateSchema.shape.values.parse
        > = {};
        const bindings: Record<string, AutomationVariableApproval> = {};
        for (const [name, slot] of Object.entries(props.preset.slots)) {
          const mode = slot.bindable ? raw[`mode_${name}`] : "literal";
          let variable: AutomationVariableResource | undefined;
          if (mode === "shared")
            variable = automationVariableResourceSchema.parse(
              raw[`binding_${name}`],
            );
          else if (mode === "create") {
            if (!props.canManageVariables || !props.onCreateShared)
              throw new FormValidationError({
                path: `mode_${name}`,
                message: tr("automation.sharing.manageRequired"),
              });
            variable = await props.onCreateShared(
              String(raw[`key_${name}`]),
              automationVariableValueSchema.parse({
                kind: slot.kind,
                value: raw[name],
              }),
            );
            // An explicitly created variable survives a later rule refusal.
            // Retain its identity in the form so retry never overwrites its key.
            form.input[`mode_${name}`].set("shared");
            form.input[`shared_${name}`].set(variable.id);
            form.input[`binding_${name}`].set(variable);
          }
          if (variable) {
            if (
              !variable.available ||
              !variable.value ||
              variable.kind !== slot.kind
            )
              throw new FormValidationError({
                path: `shared_${name}`,
                message: tr("automation.sharing.chooseVariable"),
              });
            selectedLabels.current[name] = tr(
              "automation.sharing.boundSummary",
              { args: [variable.key] },
            );
            values[name] = variable.value.value;
            bindings[name] = {
              id: variable.id,
              key: variable.key,
              version: variable.version,
            };
          } else if (raw[name] !== undefined)
            values[name] = automationFilterValueSchema.parse(raw[name]);
        }
        await props.onSubmit(values, bindings, { ...selectedLabels.current });
      },
    },
    [schema],
  );
  const current = useFormValues(form);
  const { loading } = useFormState(form, ["loading"]);
  const busy = props.disabled || loading;
  return (
    <form {...form.props} className="flex max-w-xl flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">
          {tr(`automation.preset.${props.preset.key}.title` as never, {
            default: props.preset.title,
          })}
        </h2>
        <p className="text-muted-foreground text-sm">
          {tr(`automation.preset.${props.preset.key}.description` as never, {
            default: props.preset.description,
          })}
        </p>
      </div>
      {Object.entries(props.preset.slots).map(([name, slot]) => {
        const label = tr(`automation.setup.${name}` as never, {
          default: name,
        });
        const mode = current[`mode_${name}`] ?? "literal";
        const navigation = props.choiceNavigation?.[name];
        const availableVariables = (props.variables ?? []).filter(
          (variable) =>
            variable.available &&
            variable.value &&
            variable.kind === slot.kind &&
            literalSchema.shape[name].safeParse(variable.value.value).success,
        );
        const selected = automationVariableResourceSchema.safeParse(
          current[`binding_${name}`],
        );
        const latest = selected.success
          ? availableVariables.find(
              (variable) => variable.id === selected.data.id,
            )
          : undefined;
        const variables =
          selected.success &&
          selected.data.available &&
          selected.data.value &&
          selected.data.kind === slot.kind
            ? [
                selected.data,
                ...availableVariables.filter(
                  (variable) => variable.id !== selected.data.id,
                ),
              ]
            : availableVariables;
        const items =
          props.choices[name] ??
          slot.values?.map((value) => ({
            value: String(value),
            label: tr(`automation.channel.${String(value)}` as never, {
              default: String(value),
            }),
          }));
        return (
          <div
            key={name}
            className="border-border flex flex-col gap-3 border-b pb-5"
          >
            {slot.bindable && (
              <Control
                input={form.input[`mode_${name}`]}
                label={tr("automation.sharing.source", { args: [label] })}
                select
                items={[
                  { value: "literal", label: tr("automation.sharing.literal") },
                  { value: "shared", label: tr("automation.sharing.existing") },
                  ...(props.canManageVariables && props.onCreateShared
                    ? [
                        {
                          value: "create",
                          label: tr("automation.sharing.create"),
                        },
                      ]
                    : []),
                ]}
                disabled={busy}
              />
            )}
            {mode !== "shared" && (
              <Control
                input={form.input[name]}
                label={label}
                select={!!items}
                items={items}
                disabled={busy || navigation?.loading}
              />
            )}
            {mode === "shared" && (
              <>
                <Control
                  input={form.input[`shared_${name}`]}
                  label={tr("automation.sharing.variable", { args: [label] })}
                  select
                  items={variables.map((variable) => ({
                    value: variable.id,
                    label: `${variable.key} (v${variable.version})`,
                  }))}
                  disabled={busy || props.variableNavigation?.loading}
                />
                {selected.success && (
                  <p className="text-muted-foreground text-xs">
                    {tr("automation.sharing.approvedVersion", {
                      args: [selected.data.key, l(selected.data.version)],
                    })}
                  </p>
                )}
                {latest &&
                  selected.success &&
                  latest.version !== selected.data.version && (
                    <Button
                      type="button"
                      variant="outlined"
                      size="sm"
                      disabled={busy}
                      onClick={() => form.input[`binding_${name}`].set(latest)}
                    >
                      {tr("automation.sharing.useCurrent")}
                    </Button>
                  )}
              </>
            )}
            {mode === "create" && (
              <Control
                input={form.input[`key_${name}`]}
                label={tr("automation.sharing.key")}
                description={tr("automation.sharing.createDescription")}
                disabled={busy}
              />
            )}
            {mode !== "shared" &&
              navigation &&
              (navigation.hasMore || navigation.offset > 0) && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="minimal"
                    size="sm"
                    disabled={busy || navigation.loading || !navigation.offset}
                    onClick={navigation.previous}
                  >
                    {tr("automation.previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="minimal"
                    size="sm"
                    disabled={busy || navigation.loading || !navigation.hasMore}
                    onClick={navigation.next}
                  >
                    {tr("automation.next")}
                  </Button>
                </div>
              )}
          </div>
        );
      })}
      {Object.keys(props.preset.slots).some(
        (name) => current[`mode_${name}`] === "shared",
      ) &&
        props.variableNavigation && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {tr("automation.sharing.pages")}
            </span>
            <Button
              type="button"
              variant="minimal"
              size="sm"
              disabled={
                busy ||
                props.variableNavigation.loading ||
                !props.variableNavigation.offset
              }
              onClick={props.variableNavigation.previous}
            >
              {tr("automation.previous")}
            </Button>
            <Button
              type="button"
              variant="minimal"
              size="sm"
              disabled={
                busy ||
                props.variableNavigation.loading ||
                !props.variableNavigation.hasMore
              }
              onClick={props.variableNavigation.next}
            >
              {tr("automation.next")}
            </Button>
          </div>
        )}
      <div className="flex gap-2">
        <Button
          type="submit"
          intent="primary"
          loading={loading}
          disabled={busy}
        >
          {tr("automation.preset.createDisabled")}
        </Button>
        {props.onCancel && (
          <Button
            type="button"
            variant="minimal"
            disabled={busy}
            onClick={props.onCancel}
          >
            {tr("automation.setup.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
};

export default AutomationPresetForm;
