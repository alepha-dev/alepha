import type { ZObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useEffect, useId, useMemo, useRef } from "react";
import { type FormCtrlOptions, FormModel } from "../services/FormModel.ts";

/**
 * Shallow / structural equality for form initial-value objects. Form values
 * are plain data (strings, numbers, arrays, plain objects) so JSON.stringify
 * is both fast enough and exact. Wrapped in try/catch to fall back to
 * reference equality if anything exotic sneaks in (e.g. circular refs).
 */
const stableEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/**
 * Custom hook to create a form with validation and field management.
 * This hook uses Zod schemas to define the structure and validation rules for the form.
 * It provides a way to handle form submission, field creation, and value management.
 *
 * @example
 * ```tsx
 * import { z } from "alepha";
 *
 * const form = useForm({
 *   schema: z.object({
 *     username: z.text(),
 *     password: z.text(),
 *   }),
 *   handler: (values) => {
 *     console.log("Form submitted with values:", values);
 *   },
 * });
 *
 * return (
 *   <form {...form.props}>
 *     <input {...form.input.username.props} />
 *     <input {...form.input.password.props} />
 *     <button type="submit">Submit</button>
 *   </form>
 * );
 * ```
 */
export const useForm = <T extends ZObject>(
  options: FormCtrlOptions<T>,
  deps: any[] = [],
): FormModel<T> => {
  const alepha = useAlepha();
  const formId = useId();
  const initialValuesRef = useRef(options.initialValues);

  const form = useMemo(() => {
    return alepha.inject(FormModel<T>, {
      lifetime: "transient",
      args: [options.id || formId, options],
    });
  }, deps);

  // The model is memoized once, but callers' handlers close over
  // render-scoped state ("const [rows, setRows] = useState(...)" then
  // "handler: () => onNext(rows)"). Invoking the mount-time closure submits
  // the INITIAL state — edits silently vanish. Keep the callbacks fresh on
  // every commit so submit always sees the latest render's closures.
  useEffect(() => {
    Object.assign(form.options, {
      handler: options.handler,
      onError: options.onError,
      onChange: options.onChange,
      onReset: options.onReset,
      onCreateField: options.onCreateField,
    });
  });

  useEffect(() => {
    // Reference inequality alone is unsafe: callers commonly build the
    // `initialValues` object inline at the top of their render, which yields
    // a fresh reference every commit. Reinitializing on every render wipes
    // user-typed values via `setInitialValues` while leaving the DOM stale,
    // producing the "I filled the form but submit says it's empty" bug.
    //
    // Deep-equality (JSON-compare) catches the common case where the inline
    // literal is rebuilt with the same content. Callers who legitimately
    // need to swap initial values mid-edit (e.g. editing quest A → quest B)
    // still see a different JSON shape and trigger the reinit.
    if (stableEqual(initialValuesRef.current, options.initialValues)) {
      return;
    }
    initialValuesRef.current = options.initialValues;
    if (options.initialValues) {
      form.setInitialValues(options.initialValues as Record<string, any>);
    }
  }, [options.initialValues]);

  return form;
};
