import { useAlepha } from "alepha/react";
import { useEffect, useState } from "react";
import type { BaseInputField } from "../services/FormModel.ts";

/**
 * Hook to subscribe to a single form field's value.
 * Only re-renders when this specific field changes.
 *
 * @returns A tuple of [value, setValue] similar to useState.
 */
export const useFieldValue = (
  input: BaseInputField,
): [any, (value: any) => void] => {
  const alepha = useAlepha();
  const [value, setValue] = useState(input?.initialValue);

  useEffect(() => {
    if (!input?.form || !alepha.isBrowser()) {
      return;
    }

    return alepha.events.on("form:change", (ev) => {
      if (ev.id === input.form.id && ev.path === input.path) {
        setValue(ev.value);
      }
    });
  }, []);

  const setFieldValue = (newValue: any) => {
    input.set(newValue);
  };

  return [value, setFieldValue];
};
