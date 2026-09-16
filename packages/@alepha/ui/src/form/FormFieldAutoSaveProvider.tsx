import * as React from "react";

void React;

import { createContext, type ReactNode, useContext } from "react";

export interface FormFieldAutoSaveProviderProps {
  value: boolean;
  children: ReactNode;
}

export const FormFieldAutoSaveProvider = (
  props: FormFieldAutoSaveProviderProps,
) => {
  return (
    <FormFieldAutoSaveContext.Provider value={props.value}>
      {props.children}
    </FormFieldAutoSaveContext.Provider>
  );
};

/**
 * Ambient flag enabling the inline save (tick) affordance on text Controls.
 * Set by `<AutoForm autoSave>`; standalone Controls never show the tick
 * unless explicitly placed inside this provider.
 *
 * Context exemption: a form's own setting for the fields inside it; two forms
 * on one page may disagree.
 */
const FormFieldAutoSaveContext = createContext<boolean>(false);

/**
 * Read the ambient auto-save flag (see {@link FormFieldAutoSaveProvider}).
 */
export function useFormFieldAutoSave(): boolean {
  return useContext(FormFieldAutoSaveContext);
}
