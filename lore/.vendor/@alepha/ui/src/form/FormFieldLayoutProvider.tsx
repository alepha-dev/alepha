import * as React from "react";

void React;

import { createContext, type ReactNode, useContext } from "react";

export interface FormFieldLayoutProviderProps {
  value: FormFieldLayout;
  children: ReactNode;
}

export const FormFieldLayoutProvider = (
  props: FormFieldLayoutProviderProps,
) => {
  return (
    <FormFieldLayoutContext.Provider value={props.value}>
      {props.children}
    </FormFieldLayoutContext.Provider>
  );
};

export type FormFieldLayout = "stack" | "row";

/**
 * Ambient layout for every nested `<FormField>`. Defaults to `"stack"`.
 * `<AutoForm layout="row">` wraps its tree in this context so every Control
 * variant renders as a settings-style row without prop drilling.
 *
 * Context exemption: a container's configuration for the fields inside it.
 * Two forms with different layouts on one page need two values, and an
 * `$atom` holds one per container.
 */
const FormFieldLayoutContext = createContext<FormFieldLayout>("stack");

/**
 * Read the ambient layout (see {@link FormFieldLayoutProvider}).
 *
 * `<FormField>` reads this itself, so a widget only needs the hook when it
 * sizes or arranges something *around* its FormField — `<Control>` uses it to
 * give text inputs the settings-row column width.
 */
export function useFormFieldLayout(): FormFieldLayout {
  return useContext(FormFieldLayoutContext);
}
