import { useAlepha } from "alepha/react";
import { useEffect, useRef, useState } from "react";

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

  const formId = input?.form?.id;
  const path = input?.path;

  // Re-subscribed when the path changes, not pinned at mount. An array row's
  // path is its INDEX, so removing a sibling moves every row below it: a
  // subscription taken at mount then listened to the path of whichever row
  // used to sit there.
  useEffect(() => {
    if (!input?.form || !alepha.isBrowser()) {
      return;
    }

    return alepha.events.on("form:change", (ev) => {
      if (ev.id === formId && ev.path === path) {
        setValue(ev.value);
      }
    });
  }, [alepha, formId, path]);

  // A moved row renders the value of the row that used to be at this path, so
  // it has to be re-seeded. `initialValue` is recomputed from live form state
  // on every render, so it is what this path holds now - not a mount-time
  // snapshot, despite the name.
  const seededPath = useRef(path);
  useEffect(() => {
    if (seededPath.current === path) {
      return;
    }
    seededPath.current = path;
    setValue(input?.initialValue);
  }, [path, input?.initialValue]);

  const setFieldValue = (newValue: any) => {
    input.set(newValue);
  };

  return [value, setFieldValue];
};
