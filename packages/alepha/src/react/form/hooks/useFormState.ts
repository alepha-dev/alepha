import { SchemaValidationError, type ZObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useEffect, useState } from "react";
import type { FormModel } from "../services/FormModel.ts";

export interface UseFormStateReturn {
  loading: boolean;
  dirty: boolean;
  values?: Record<string, any>;
  error?: Error;
}

/**
 * Tracks whichever `form` the caller currently passes in, not only the one
 * it saw on the first render — same rationale as `useFormValues`. Without
 * this, a caller that swaps forms (via `useForm`'s `deps` parameter minting
 * a fresh `FormModel`) would keep this hook's `form:change` /
 * `form:submit:*` / `form:reset` listeners bound to the OLD form's `id`
 * forever: `loading` would never turn on again for the new form's
 * submissions, `dirty` would never move, and `values` would freeze on
 * whatever the old form last held.
 *
 * The re-seed on a form swap happens during render (not inside the
 * effect), so no frame paints the previous form's `dirty`/`loading`/
 * `error`/`values` under the new form's identity before the effect below
 * has a chance to re-subscribe.
 */
export const useFormState = <
  T extends ZObject,
  Keys extends keyof UseFormStateReturn,
>(
  target: FormModel<T> | { form: FormModel<T>; path: string },
  _events: Keys[] = ["loading", "dirty", "error"] as Keys[],
): Pick<UseFormStateReturn, Keys> => {
  const alepha = useAlepha();
  const events = _events as string[];

  const form = "form" in target ? target.form : target;
  const path = "form" in target ? target.path : undefined;

  const hasValues = events.includes("values");
  const hasErrors = events.includes("error");
  const hasDirty = events.includes("dirty");
  const hasLoading = events.includes("loading");

  const [trackedForm, setTrackedForm] = useState(form);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [values, setValues] = useState<Record<string, any> | undefined>(() =>
    hasValues ? form.currentValues : undefined,
  );

  if (trackedForm !== form) {
    setTrackedForm(form);
    setDirty(false);
    setLoading(false);
    setError(undefined);
    setValues(hasValues ? form.currentValues : undefined);
  }

  useEffect(() => {
    const listeners: Function[] = [];

    if (hasErrors || hasValues || hasDirty) {
      listeners.push(
        alepha.events.on("form:change", (event) => {
          if (event.id === form.id) {
            if (!path || event.path === path) {
              // `initial: true` marks a programmatic reset (e.g. parent
              // re-rendering with fresh data via `setInitialValues`). Treat
              // it like a reset: clear dirty, don't mark dirty.
              if (hasDirty) {
                if (event.initial) {
                  setDirty(false);
                } else {
                  setDirty(true);
                }
              }
              if (hasErrors) {
                setError(undefined);
              }
            }
            if (hasValues) {
              setValues(form.currentValues);
            }
          }
        }),
      );
    }

    if (hasLoading) {
      listeners.push(
        alepha.events.on("form:submit:begin", (event) => {
          if (event.id === form.id) {
            setLoading(true);
          }
        }),
        alepha.events.on("form:submit:end", (event) => {
          if (event.id === form.id) {
            setLoading(false);
          }
        }),
      );
    }

    if (hasValues || hasDirty) {
      listeners.push(
        alepha.events.on("form:submit:success", (event) => {
          if (event.id === form.id) {
            if (hasValues) {
              setValues(event.values);
            }
            if (hasDirty) {
              setDirty(false);
            }
          }
        }),
      );
    }

    if (hasDirty) {
      listeners.push(
        alepha.events.on("form:reset", (event) => {
          if (event.id === form.id) {
            setDirty(false);
          }
        }),
      );
    }

    if (hasErrors) {
      listeners.push(
        alepha.events.on("form:submit:error", (event) => {
          if (event.id === form.id) {
            if (
              !path ||
              (event.error instanceof SchemaValidationError &&
                event.error.value.path === path)
            ) {
              setError(event.error);
            }
          }
        }),
      );
    }

    return () => {
      for (const unsub of listeners) {
        unsub();
      }
    };
  }, [alepha, form, path, hasErrors, hasValues, hasDirty, hasLoading]);

  return {
    dirty,
    loading,
    error,
    values,
  } as Pick<UseFormStateReturn, Keys>;
};
