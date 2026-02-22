import { ActionButton, type ActionSubmitButtonProps } from "@alepha/ui";
import { Card, Flex, type FlexProps, Grid } from "@mantine/core";
import type { TObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import type { ReactNode } from "react";
import Control, { type ControlProps } from "./Control.tsx";

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
  schema?: TObject;
  children?: (input: FormModel<T>["input"]) => ReactNode;

  /**
   * Control props applied to all fields.
   */
  controlProps?: Partial<Omit<ControlProps, "input">>;

  /**
   * Per-field control props override.
   * Keys are field names from the schema.
   */
  fieldControlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;
  skipFormElement?: boolean;
  skipSubmitButton?: boolean;
  submitButtonProps?: Partial<Omit<ActionSubmitButtonProps, "form">>;
  resetButtonProps?: Partial<Omit<ActionSubmitButtonProps, "form">>;

  fill?: boolean;
  flexProps?: FlexProps;

  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

/**
 * TypeForm component that automatically renders all form inputs based on schema.
 * Uses the Control component to render individual fields and Mantine Grid for responsive layout.
 *
 * Supports all field types including:
 * - Primitive types (string, number, boolean, etc.)
 * - Enum types (rendered as Select)
 * - Arrays of primitives (rendered as MultiSelect/TagsInput)
 * - Arrays of objects (rendered as ControlArray)
 * - Nested objects (rendered as ControlObject)
 *
 * @example
 * ```tsx
 * import { t } from "alepha";
 * import { useForm } from "alepha/react/form";
 * import { TypeForm } from "@alepha/ui";
 *
 * const form = useForm({
 *   schema: t.object({
 *     username: t.text(),
 *     email: t.text(),
 *     age: t.integer(),
 *     subscribe: t.boolean(),
 *     address: t.object({
 *       street: t.text(),
 *       city: t.text(),
 *     }),
 *     tags: t.array(t.text()),
 *     contacts: t.array(t.object({
 *       name: t.text(),
 *       email: t.text(),
 *     })),
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
    columns = 3,
    children,
    controlProps,
    fieldControlProps,
    skipFormElement = false,
    skipSubmitButton = false,
    submitButtonProps,
    fill = true,
    size,
  } = props;

  const schema = props.schema || form.options.schema;
  if (!schema?.properties) {
    return null;
  }

  const fieldNames = Object.keys(schema.properties);

  // Filter to only include valid InputFields
  // All types are now supported: primitives, enums, arrays, objects
  const supportedFields = fieldNames;

  // Handle column configuration with defaults: xs=1, sm=2, lg=3
  const colSpan =
    typeof columns === "number"
      ? {
          xs: 12,
          sm: 6,
          lg: 12 / columns,
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
          const fieldSchema: any = schema.properties[fieldName];

          // Type guard to ensure field has the expected structure
          if (!field || !fieldSchema) {
            return null;
          }

          // Determine if this is a complex type (object or array of objects)
          // that should span full width
          const isObject =
            fieldSchema &&
            "type" in fieldSchema &&
            fieldSchema.type === "object";

          const isArrayOfObjects =
            fieldSchema &&
            "type" in fieldSchema &&
            fieldSchema.type === "array" &&
            "items" in fieldSchema &&
            fieldSchema.items &&
            "properties" in fieldSchema.items;

          // Complex types span full width, primitives use grid columns
          const span = isObject || isArrayOfObjects ? 12 : colSpan;

          // Merge control props: base controlProps + field-specific overrides
          const mergedControlProps = {
            ...controlProps,
            ...fieldControlProps?.[fieldName],
          };

          if (size) {
            mergedControlProps.size = size;
          }

          return (
            <Grid.Col key={fieldName} span={span}>
              <Control input={field} {...mergedControlProps} />
            </Grid.Col>
          );
        })}
      </Grid>
    );
  };

  const content = (
    <Flex
      direction={"column"}
      gap={"sm"}
      flex={fill ? 1 : undefined}
      {...props.flexProps}
    >
      <Flex direction={"column"} gap={"sm"} flex={1}>
        {renderFields()}
      </Flex>
      {!skipSubmitButton && (
        <Card w={"100%"} withBorder>
          <Flex gap={"sm"} flex={1}>
            <Flex></Flex>
            <Flex flex={1}></Flex>
            <Flex gap={"sm"}>
              <ActionButton variant={"subtle"} type={"reset"}>
                Reset
              </ActionButton>
              <ActionButton
                intent={"primary"}
                form={form}
                {...submitButtonProps}
              >
                {submitButtonProps?.children ?? "Submit"}
              </ActionButton>
            </Flex>
          </Flex>
        </Card>
      )}
    </Flex>
  );

  if (skipFormElement) {
    return content;
  }

  return (
    <Flex
      component={"form"}
      flex={fill ? 1 : undefined}
      {...form.props}
      {...props.flexProps}
    >
      {content}
    </Flex>
  );
};

export default TypeForm;
