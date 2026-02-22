import { Flex } from "@mantine/core";
import type { Static, TObject } from "alepha";
import { useForm } from "alepha/react/form";
import { useEffect } from "react";
import type { FormDialogOptions } from "../../services/DialogService.tsx";
import ActionButton from "../buttons/ActionButton.tsx";
import TypeForm from "../form/TypeForm.tsx";

export interface FormDialogProps<T extends TObject = TObject> {
  options: FormDialogOptions<T>;
  onSubmit: (value: Static<T> | null) => void;
}

const FormDialog = <T extends TObject>({
  options,
  onSubmit,
}: FormDialogProps<T>) => {
  const form = useForm({
    schema: options.schema,
    handler: async (data) => {
      onSubmit(data as Static<T>);
    },
  });

  useEffect(() => {
    if (options.defaults) {
      for (const [key, value] of Object.entries(options.defaults)) {
        if (key in form.input) {
          (form.input as Record<string, any>)[key]?.set(value);
        }
      }
    }
  }, [options.defaults]);

  return (
    <form {...form.props}>
      <Flex direction="column" gap="md">
        <TypeForm
          form={form}
          columns={options.columns}
          fieldControlProps={options.fieldControlProps}
          controlProps={options.controlProps}
          skipSubmitButton
          skipFormElement
        />
        <Flex justify="flex-end" gap="xs">
          <ActionButton variant="subtle" onClick={() => onSubmit(null)}>
            {options.cancelLabel || "Cancel"}
          </ActionButton>
          <ActionButton form={form}>
            {options.submitLabel || "Submit"}
          </ActionButton>
        </Flex>
      </Flex>
    </form>
  );
};

export default FormDialog;
