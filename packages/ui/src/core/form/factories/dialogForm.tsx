import type { BaseDialogOptions } from "@alepha/ui";
import type { TObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import TypeForm, { type TypeFormProps } from "../components/TypeForm.tsx";

export interface DialogFormOptions<T extends TObject>
  extends BaseDialogOptions {
  typeFormProps?: Partial<Omit<TypeFormProps<T>, "form">>;
}

/**
 * Creates dialog options for a form dialog.
 *
 * @param form - The form model to render.
 * @param options - Additional dialog and TypeForm options.
 */
export const dialogForm = <T extends TObject>(
  form: FormModel<T>,
  options?: DialogFormOptions<T>,
): BaseDialogOptions => ({
  size: "lg",
  title: options?.title || "Form",
  ...options,
  content: (
    <TypeForm
      form={form}
      skipSubmitButton={false}
      {...options?.typeFormProps}
    />
  ),
});
