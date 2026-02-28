import type { ControlProps } from "./components/Control.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export type { ControlProps } from "./components/Control.tsx";
export { default as Control } from "./components/Control.tsx";
export { default as ControlArray } from "./components/ControlArray.tsx";
export { default as ControlDate } from "./components/ControlDate.tsx";
export { default as ControlNumber } from "./components/ControlNumber.tsx";
export { default as ControlObject } from "./components/ControlObject.tsx";
export { default as ControlQueryBuilder } from "./components/ControlQueryBuilder.tsx";
export type {
  ControlSelectProps,
  SelectValueLabel,
} from "./components/ControlSelect.tsx";
export { default as ControlSelect } from "./components/ControlSelect.tsx";
export type { TypeFormProps } from "./components/TypeForm.tsx";
export { default as TypeForm } from "./components/TypeForm.tsx";
export { type DialogFormOptions, dialogForm } from "./factories/dialogForm.tsx";

// ---------------------------------------------------------------------------------------------------------------------

declare module "typebox" {
  interface TSchemaOptions {
    $control?: Omit<ControlProps, "input">;
  }
}
