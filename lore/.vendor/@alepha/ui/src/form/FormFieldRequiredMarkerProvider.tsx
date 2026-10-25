import * as React from "react";

void React;

import { createContext, type ReactNode, useContext } from "react";

export interface FormFieldRequiredMarkerProviderProps {
  value: boolean;
  children: ReactNode;
}

export const FormFieldRequiredMarkerProvider = (
  props: FormFieldRequiredMarkerProviderProps,
) => {
  return (
    <FormFieldRequiredMarkerContext.Provider value={props.value}>
      {props.children}
    </FormFieldRequiredMarkerContext.Provider>
  );
};

/**
 * Ambient control over the required marker (`*`). Defaults to showing it.
 *
 * `<AutoForm requiredMarker={false}>` turns it off for a form where nearly
 * every field is required and the asterisks are noise rather than news.
 *
 * ⚠️ **This is a purely visual switch, and must stay one.** The marker is
 * `aria-hidden`, so it never carried the information to assistive tech in the
 * first place — `aria-required` on the input does, and it is set from the
 * schema regardless of this flag. Hiding the marker must never be the reason a
 * field stops announcing that it is required.
 *
 * Context exemption: a form's own setting for the fields inside it; two forms
 * on one page may disagree.
 */
const FormFieldRequiredMarkerContext = createContext<boolean>(true);

/**
 * Read the ambient required-marker flag (see
 * {@link FormFieldRequiredMarkerProvider}).
 */
export function useFormFieldRequiredMarker(): boolean {
  return useContext(FormFieldRequiredMarkerContext);
}
