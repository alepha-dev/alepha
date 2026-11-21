import type { ZObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useEffect, useMemo, useReducer, useState } from "react";

import { FormValidationError } from "../errors/FormValidationError.ts";
import type { FormModel } from "../services/FormModel.ts";

export interface UseFormStateReturn {
  loading: boolean;
  dirty: boolean;
  values?: Record<string, any>;
  error?: Error;
}

/**
 * Tracks whichever `form` the caller currently passes in, not only the one
 * it saw on the first render - same rationale as `useFormValues`. Without
 * this, a caller that swaps forms (via `useForm`'s `deps` parameter minting
 * a fresh `FormModel`) would keep the old model's `dirty`, `loading`,
 * `error` and `values` on screen. The new model has the same `id` unless the
 * caller changes it; when it does, the `form:changed` / `form:submit:*` /
 * `form:reset` listeners would also stay bound to the old `id`, so
 * `loading` would never turn on again and `dirty` would never move.
 *
 * The re-seed on a form swap happens during render (not inside the
 * effect), so no frame paints the previous form's `dirty`/`loading`/
 * `error`/`values` under the new form's identity before the effect below
 * has a chance to re-subscribe.
 *
 * ## `error`
 *
 * - With `{ form, path }`, it is that field's entry in `form.errors`, as a
 *   `FormValidationError` carrying the path and message. It is read from the
 *   model, so a field mounted after the failure (a tab, a collapsed object,
 *   an array row) shows it too.
 * - With the form alone, it is the last submit's error, whatever it was,
 *   until the next change.
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
  // The field's error is read from the model on every render, so it can
  // never disagree with it; the event only asks for that render.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const fieldMessage = path && hasErrors ? form.errors[path] : undefined;
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
        alepha.events.on("form:changed", (event) => {
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
              if (hasErrors && !path) {
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
            // The success says the values it sent are saved, not the ones
            // typed since: an edit made while it was in flight keeps the
            // form dirty. A write the handler made itself (the baseline put
            // back, the sent value written back) leaves nothing to send.
            if (hasDirty && !form.hasUnsavedValues()) {
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

    if (hasErrors && path) {
      listeners.push(
        alepha.events.on("form:errors:changed", (event) => {
          if (event.id === form.id) {
            refresh();
          }
        }),
      );
    }

    if (hasErrors && !path) {
      listeners.push(
        alepha.events.on("form:submit:error", (event) => {
          if (event.id === form.id) {
            setError(event.error);
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

  const fieldError = useMemo(
    () =>
      path && fieldMessage !== undefined
        ? new FormValidationError({ message: fieldMessage, path })
        : undefined,
    [path, fieldMessage],
  );

  return {
    dirty,
    loading,
    error: path ? fieldError : error,
    values,
  } as Pick<UseFormStateReturn, Keys>;
};
