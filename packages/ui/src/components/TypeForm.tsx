import type { TObject } from "@alepha/core";
import type { FormModel } from "@alepha/react-form";
import { Grid, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import Action, { type ActionSubmitProps } from "./Action";
import Control, { type ControlProps } from "./Control";

export interface TypeFormProps<T extends TObject> {
  form: FormModel<T>;
  columns?:
    | number
    | {
        base?: number;
        xs?: number;
        sm?: number;
        md?: number;
        lg?: number;
        xl?: number;
      };
  children?: (input: FormModel<T>["input"]) => ReactNode;
  controlProps?: Partial<Omit<ControlProps, "input">>;
  skipFormElement?: boolean;
  skipSubmitButton?: boolean;
  submitButtonProps?: Partial<Omit<ActionSubmitProps, "form">>;
}

/**
 * TypeForm component that automatically renders all form inputs based on schema.
 * Uses the Control component to render individual fields and Mantine Grid for responsive layout.
 *
 * @example
 * ```tsx
 * import { t } from "alepha";
 * import { useForm } from "@alepha/react-form";
 * import { TypeForm } from "@alepha/ui";
 *
 * const form = useForm({
 *   schema: t.object({
 *     username: t.text(),
 *     email: t.text(),
 *     age: t.integer(),
 *     subscribe: t.boolean(),
 *   }),
 *   handler: (values) => {
 *     console.log(values);
 *   },
 * });
 *
 * return <TypeForm form={form} columns={2} />;
 * ```
 */
const TypeForm = <T extends TObject>(props: TypeFormProps<T>) => {
  const {
    form,
    columns = 1,
    children,
    controlProps,
    skipFormElement = false,
    skipSubmitButton = false,
    submitButtonProps,
  } = props;

  if (!form.options?.schema?.properties) {
    return null;
  }

  const fieldNames = Object.keys(form.options.schema.properties);

  // Filter out unsupported field types (objects, arrays, etc.)
  const supportedFields = fieldNames.filter((fieldName) => {
    const field = form.input[fieldName as keyof typeof form.input];
    if (!field || typeof field !== "object" || !("schema" in field)) {
      return false;
    }

    const schema: any = field.schema;

    // Skip if it's an object or array (not supported by Control)
    if ("type" in schema) {
      if (schema.type === "object" || schema.type === "array") {
        return false;
      }
    }

    // Check if it has properties (nested object)
    if ("properties" in schema && schema.properties) {
      return false;
    }

    return true;
  });

  // Handle column configuration with defaults: xs=1, sm=2, lg=3
  const colSpan =
    typeof columns === "number"
      ? {
          xs: 12,
          sm: 6,
          lg: 12 / 3,
        }
      : {
          base: columns.base ? 12 / columns.base : undefined,
          xs: columns.xs ? 12 / columns.xs : 12,
          sm: columns.sm ? 12 / columns.sm : 6,
          md: columns.md ? 12 / columns.md : undefined,
          lg: columns.lg ? 12 / columns.lg : 4,
          xl: columns.xl ? 12 / columns.xl : undefined,
        };

  const renderFields = () => {
    if (children) {
      return <>{children(form.input)}</>;
    }

    return (
      <Grid>
        {supportedFields.map((fieldName) => {
          const field = form.input[fieldName as keyof typeof form.input];

          // Type guard to ensure field has the expected structure
          if (!field || typeof field !== "object" || !("schema" in field)) {
            return null;
          }

          return (
            <Grid.Col key={fieldName} span={colSpan}>
              <Control input={field as any} {...controlProps} />
            </Grid.Col>
          );
        })}
      </Grid>
    );
  };

  const content = (
    <Stack>
      {renderFields()}
      {!skipSubmitButton && (
        <Action form={form} {...submitButtonProps}>
          {submitButtonProps?.children ?? "Submit"}
        </Action>
      )}
    </Stack>
  );

  if (skipFormElement) {
    return content;
  }

  return (
    <form onSubmit={form.onSubmit} noValidate>
      {content}
    </form>
  );
};

export default TypeForm;
