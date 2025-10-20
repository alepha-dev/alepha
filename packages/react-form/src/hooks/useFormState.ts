import { type TObject, TypeBoxError } from "@alepha/core";
import { useAlepha } from "@alepha/react";
import { useEffect, useState } from "react";
import type { FormModel } from "../services/FormModel.ts";

export interface UseFormStateReturn<T extends TObject> {
  loading: boolean;
  dirty: boolean;
  values?: T;
  error?: Error;
}

export type FormStateEvent = "change" | "submit" | "error";

export const useFormState = <T extends TObject>(
  target: FormModel<T> | { form: FormModel<T>; path: string },
  events: FormStateEvent[] = ["change", "submit", "error"],
): UseFormStateReturn<T> => {
  const alepha = useAlepha();

  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const form = "form" in target ? target.form : target;
  const path = "path" in target ? target.path : undefined;

  useEffect(() => {
    const listeners: Function[] = [];

    if (events.includes("change") || events.includes("error")) {
      listeners.push(
        alepha.events.on("form:change", (event) => {
          if (event.id === form.id) {
            if (!path || event.path === path) {
              setDirty(true);
              setError(undefined);
            }
          }
        }),
        alepha.events.on("form:submit:success", (event) => {
          if (event.id === form.id) {
            setDirty(false);
          }
        }),
      );
    }

    if (events.includes("submit")) {
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

    if (events.includes("error")) {
      listeners.push(
        alepha.events.on("form:submit:error", (event) => {
          if (event.id === form.id) {
            if (
              !path ||
              (event.error instanceof TypeBoxError &&
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
  };
};
