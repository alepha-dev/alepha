import { SchemaValidationError, type TObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useEffect, useState } from "react";
import type { FormModel } from "../services/FormModel.ts";

export interface UseFormStateReturn {
  loading: boolean;
  dirty: boolean;
  values?: Record<string, any>;
  error?: Error;
}

export const useFormState = <
  T extends TObject,
  Keys extends keyof UseFormStateReturn,
>(
  target: FormModel<T> | { form: FormModel<T>; path: string },
  _events: Keys[] = ["loading", "dirty", "error"] as Keys[],
): Pick<UseFormStateReturn, Keys> => {
  const alepha = useAlepha();
  const events = _events as string[];

  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [values, setValues] = useState<Record<string, any> | undefined>(
    undefined,
  );

  const form = "form" in target ? target.form : target;
  const path = "path" in target ? target.path : undefined;

  const hasValues = events.includes("values");
  const hasErrors = events.includes("error");
  const hasDirty = events.includes("dirty");
  const hasLoading = events.includes("loading");

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
  }, []);

  return {
    dirty,
    loading,
    error,
    values,
  } as Pick<UseFormStateReturn, Keys>;
};
