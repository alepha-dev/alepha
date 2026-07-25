import type { FormModel } from "alepha/react/form";

/**
 * Schema-bound metadata read by `<Control>` (in `@alepha/ui`) to configure
 * how a field renders. Place under `$control` on any Zod schema option.
 *
 * Two forms:
 *
 * 1. **Object** — static configuration baked into the schema:
 *    ```ts
 *    z.string({ $control: { password: true, icon: "key" } })
 *    ```
 *
 * 2. **Function** — dynamic, computed from current form state:
 *    ```ts
 *    z.string({
 *      $control: ({ form, value }) => {
 *        if (form.currentValues.kind !== "advanced") return false; // hide
 *        return { items: () => fetchOptions(form.currentValues.kind) };
 *      },
 *    })
 *    ```
 *
 * The function may return:
 * - a partial `SchemaControl` to merge with explicit `<Control>` props
 * - `false` to hide the control entirely
 * - `undefined` to leave the field as-is
 */
export interface SchemaControl {
  // ── Variant forcing ────────────────────────────────────────────────
  text?: boolean;
  area?: boolean;
  password?: boolean;
  switch?: boolean;
  number?: boolean;
  file?: boolean;
  date?: boolean;
  datetime?: boolean;
  time?: boolean;
  select?: boolean;
  combobox?: boolean;
  segmented?: boolean;
  slider?: boolean;
  object?: boolean;
  array?: boolean;

  // ── Labels / hints ────────────────────────────────────────────────
  /**
   * Icon name. The registry control maps this to its icon set
   * (lucide-react). Pass `null` to suppress the schema-inferred icon.
   */
  icon?: string | null;
  label?: string;
  description?: string;
  placeholder?: string;
  /**
   * HTML `autocomplete` attribute. Use standard tokens like
   * `"username"`, `"email"`, `"new-password"`, `"current-password"`,
   * `"street-address"`, `"address-line1"`, `"address-level2"` (city),
   * `"postal-code"`, `"country"`, `"cc-number"`, `"cc-exp"`,
   * `"cc-csc"`, `"cc-name"`, `"tel"`, etc.
   */
  autoComplete?: string;

  // ── Data ──────────────────────────────────────────────────────────
  /**
   * Static or async option list for select / combobox / multi-select.
   * Each item is either a bare string (used as both value & label) or a
   * `{ value, label, description?, tag? }` object.
   */
  items?: Array<string | SchemaControlItem> | SchemaControlItemsFn;

  /**
   * Re-fetch `items` (when async) whenever any of these reference values
   * change. Useful for cascading selects.
   */
  itemsWatch?: unknown[];

  /**
   * Allow the user to create a new option by typing into a select /
   * multi-select. Pass `true` for `{ value: query, label: query }`, or a
   * function returning a custom option built from the query.
   */
  createNewEntry?:
    | boolean
    | ((query: string) => { value: string; label: string });

  // ── Layout ────────────────────────────────────────────────────────
  /**
   * Width slot inside an `<AutoForm>` group. Mapped to a grid column span.
   * - `100` → full row
   * - `75`  → 3/4 row
   * - `66`  → 2/3 row
   * - `50`  → half
   * - `33`  → one third (default for plain primitives)
   * - `25`  → one quarter
   */
  width?: 100 | 75 | 66 | 50 | 33 | 25;

  // ── Behavior ─────────────────────────────────────────────────────
  /**
   * Render `null` (hide) when truthy. Equivalent to a function `$control`
   * returning `false`, but available as a static value.
   */
  hidden?: boolean;
  disabled?: boolean;
  readOnly?: boolean;

  // ── Slots ─────────────────────────────────────────────────────────
  /**
   * Render before/after the field. Both receive the resolved input.
   * Typed loosely — UI layer narrows to `ReactNode`.
   */
  top?: unknown;
  bottom?: unknown;

  // ── File upload ───────────────────────────────────────────────────
  /**
   * Render a managed upload control (image preview, multi, drag-drop)
   * that posts to the file API and stores the resulting file ID(s) in
   * the form. Pass `true` for defaults or an options object:
   *
   * ```ts
   * $control: { upload: { multi: true, accept: "image/*", maxSize: 5_000_000 } }
   * ```
   */
  upload?:
    | boolean
    | {
        multi?: boolean;
        accept?: string;
        maxSize?: number;
        bucket?: string;
      };

  // ── Array specifics ───────────────────────────────────────────────
  arrayProps?: {
    confirmDelete?: boolean | { title?: string; message?: string };
    /** Computed label for each tab when an array uses tabs mode. */
    renderTabName?: (i: number, value: unknown) => string;
    sortable?: boolean;
    collapsible?: boolean;
    /** Force grouped (CreateForm-style) tabs even for short arrays. */
    forceTabs?: boolean;
  };

  // ── Open extension ────────────────────────────────────────────────
  [key: string]: unknown;
}

export interface SchemaControlItem {
  value: string | number | boolean;
  label: string;
  description?: string;
  tag?: string;
}

export type SchemaControlItemsFn = (
  query: string,
) =>
  | Array<string | SchemaControlItem>
  | Promise<Array<string | SchemaControlItem>>;

/**
 * Function form of `$control`. Receives the live form model + the current
 * field value, and returns a partial config (merged with explicit props),
 * `false` to hide, or `undefined` to leave as-is.
 */
export type SchemaControlFn = (context: {
  form: FormModel<any>;
  value: unknown;
}) => Partial<SchemaControl> | false | undefined;

export type SchemaControlOption = SchemaControl | SchemaControlFn;

/**
 * Resolve a raw `$control` value (object or function) into a concrete
 * partial config. Returns `null` when the field should be hidden.
 */
export const resolveSchemaControl = (
  raw: unknown,
  context: { form: FormModel<any>; value: unknown },
): Partial<SchemaControl> | null => {
  if (raw == null) return {};
  if (typeof raw === "function") {
    const result = (raw as SchemaControlFn)(context);
    if (result === false) return null;
    if (!result) return {};
    if (result.hidden) return null;
    return result;
  }
  if (typeof raw === "object") {
    const obj = raw as SchemaControl;
    if (obj.hidden) return null;
    return obj;
  }
  return {};
};

declare module "alepha" {
  interface SchemaOptions {
    /**
     * UI metadata read by `<Control>` from `@alepha/ui`. See
     * {@link SchemaControl}.
     */
    $control?: SchemaControlOption;
  }
}
