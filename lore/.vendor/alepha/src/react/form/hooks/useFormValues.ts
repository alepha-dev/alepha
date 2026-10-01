import type { ZObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useEffect, useState } from "react";

import type { FormModel } from "../services/FormModel.ts";

/**
 * Hook to subscribe to all form values.
 * Re-renders on every field change - use only when needed (debug panels, live previews).
 *
 * Tracks whichever `form` instance the caller currently passes in, not
 * only the one it saw on the first render. `useForm`'s `deps` parameter
 * (see `useForm.ts`) lets a caller mint a brand new `FormModel` - a new
 * `id`, a fresh values store - on a dependency change; without re-tracking
 * here, this hook would keep listening for `form:change` events carrying
 * the OLD model's `id` forever, so the values it returns would freeze at
 * whatever the old form last held. The render-time re-seed below (rather
 * than resetting inside the effect) avoids painting one frame of the
 * previous form's values before the effect has a chance to run.
 */
export const useFormValues = <T extends ZObject>(
  form: FormModel<T>,
): Record<string, any> => {
  const alepha = useAlepha();
  const [state, setState] = useState<{
    form: FormModel<T>;
    values: Record<string, any>;
  }>(() => ({ form, values: form.currentValues }));

  if (state.form !== form) {
    setState({ form, values: form.currentValues });
  }

  useEffect(() => {
    if (!alepha.isBrowser()) {
      return;
    }

    return alepha.events.on("form:change", (ev) => {
      if (ev.id === form.id) {
        setState((prev) => ({ ...prev, values: form.currentValues }));
      }
    });
  }, [alepha, form]);

  return state.values;
};
