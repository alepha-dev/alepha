import type { ZObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useEffect, useState } from "react";
import type { FormModel } from "../services/FormModel.ts";

/**
 * Hook to subscribe to all form values.
 * Re-renders on every field change — use only when needed (debug panels, live previews).
 */
export const useFormValues = <T extends ZObject>(
  form: FormModel<T>,
): Record<string, any> => {
  const alepha = useAlepha();
  const [values, setValues] = useState<Record<string, any>>(form.currentValues);

  useEffect(() => {
    if (!alepha.isBrowser()) {
      return;
    }

    return alepha.events.on("form:change", (ev) => {
      if (ev.id === form.id) {
        setValues(form.currentValues);
      }
    });
  }, []);

  return values;
};
