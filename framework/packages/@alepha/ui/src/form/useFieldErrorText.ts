import { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";

/**
 * The text a field shows for its error. A field left empty carries the
 * form's generic English sentence ({@link FormModel.REQUIRED_MESSAGE}),
 * translated here under `form.field.required`; every other message is the
 * schema's or the caller's own wording and is shown as is.
 */
export const useFieldErrorText = () => {
  const { tr } = useI18n();
  return useCallback(
    (error: string | undefined): string | undefined =>
      error === FormModel.REQUIRED_MESSAGE
        ? tr("form.field.required", { default: FormModel.REQUIRED_MESSAGE })
        : error,
    [tr],
  );
};
