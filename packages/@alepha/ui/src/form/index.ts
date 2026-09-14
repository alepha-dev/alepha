/**
 * Schema-driven forms.
 *
 * `AutoForm` renders a complete form from a `z.object()` schema, driven by the
 * `$control` metadata on each field. `Control` is the per-field dispatcher it
 * uses, and `ControlSelect`, `ControlDate`, `ControlDateRange`,
 * `ControlNumber`, `ControlPassword`, `ControlUpload`, `ControlArray` and
 * `ControlObject` are the renderers behind it: reach for them directly to lay a
 * form out by hand. `FormField` is the label, description and error frame they
 * share, and `resizeImage` shrinks an upload before it leaves the browser.
 *
 * Pairs with `useForm` from `alepha/react/form`.
 *
 * @module alepha.ui.form
 */

export {
  AutoForm,
  type AutoFormAction,
  type AutoFormGroup,
  type AutoFormProps,
} from "./AutoForm.tsx";
export {
  Control,
  type ControlProps,
  readSchemaControl,
  useDynamicControlRefresh,
} from "./Control.tsx";
export { ControlArray, type ControlArrayProps } from "./ControlArray.tsx";
export { ControlDate, type ControlDateProps } from "./ControlDate.tsx";
export {
  ControlDateRange,
  type ControlDateRangeProps,
} from "./ControlDateRange.tsx";
export { ControlNumber, type ControlNumberProps } from "./ControlNumber.tsx";
export { ControlObject, type ControlObjectProps } from "./ControlObject.tsx";
export {
  ControlPassword,
  type ControlPasswordProps,
} from "./ControlPassword.tsx";
export {
  ControlSelect,
  type ControlSelectProps,
  type ControlSelectSize,
  type SelectOption,
} from "./ControlSelect.tsx";
export { ControlUpload, type ControlUploadProps } from "./ControlUpload.tsx";
export {
  FormField,
  type FormFieldA11y,
  formFieldAriaProps,
  FormFieldAutoSaveProvider,
  type FormFieldAutoSaveProviderProps,
  formFieldDescriptionId,
  formFieldErrorId,
  type FormFieldLayout,
  FormFieldLayoutProvider,
  type FormFieldLayoutProviderProps,
  type FormFieldProps,
  FormFieldRequiredMarkerProvider,
  type FormFieldRequiredMarkerProviderProps,
  useFormFieldA11y,
  useFormFieldAutoSave,
  useFormFieldLayout,
  useFormFieldRequiredMarker,
} from "./FormField.tsx";
export { spanClass, widthFor } from "./grid.tsx";
export { resizeImage, type ResizeImageOptions } from "./resizeImage.ts";
