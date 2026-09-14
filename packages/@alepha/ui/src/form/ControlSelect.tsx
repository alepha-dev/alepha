import * as React from "react";

void React;

import type { Async } from "alepha";
import { useAction } from "alepha/react";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import type { HTMLAttributes } from "react";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { Segmented } from "../core/Segmented.tsx";
import { ControlSelectCombobox } from "./ControlSelectCombobox.tsx";
import { optValue } from "./controlSelectOptions.ts";
import type { ControlTriggerSize } from "./fieldTrigger.tsx";
import { FormField } from "./FormField.tsx";
import type { IconComponent } from "./iconHint.tsx";

export interface ControlSelectProps {
  /**
   * Bound `InputField` from `useForm`. Single or multi value depending on schema.
   */
  input: BaseInputField;
  /**
   * Field label. Falls back to schema `title`.
   */
  label?: string;
  /**
   * Helper text shown below the input.
   */
  description?: string;
  /**
   * Render as a `<Segmented>` control (best for 2–4 options).
   */
  segmented?: boolean;
  /**
   * Force the search input on. Kept as the historical name for
   * `searchable: true` — every select is a combobox now, the flag only
   * decides whether it carries a search field.
   */
  combobox?: boolean;
  /**
   * Whether the dropdown carries a search input. Defaults to "auto": on for a
   * long-mode `loader` (the rows are not all here), when `createNewEntry` is
   * set (typing IS how an entry is made), and for lists longer than
   * `SEARCH_THRESHOLD`. Set explicitly to search a short list or to drop the
   * search field from a long one.
   *
   * Multi-select obeys the same rule as everything else; it used to force the
   * field on because its chips box doubled as the search input.
   */
  searchable?: boolean;
  /**
   * Async option loader. Triggers long-mode (server-side search) above `loaderThreshold` options.
   */
  loader?: (search: string, resolve?: string[]) => Async<SelectOption[]>;
  /**
   * Option count above which `loader` is invoked on every search instead of once. Defaults to 100.
   */
  loaderThreshold?: number;
  /**
   * Debounce in ms applied to search queries when calling `loader` in long mode.
   */
  loaderDebounce?: number;
  /**
   * Disable the control.
   */
  disabled?: boolean;
  /**
   * Inline option list (overrides schema `enum`). Accepts either a static
   * array or an async function `(query) => SelectOption[]`. The async form
   * is mapped to a long-mode loader.
   */
  items?:
    | SelectOption[]
    | ((query: string) => SelectOption[] | Promise<SelectOption[]>);
  /**
   * Allow the user to add a new option by typing. When `true`, the typed
   * query becomes the value (and label) of a freshly created entry. When a
   * function, the function builds the option from the query.
   *
   * - For multi-select fields: each entry is appended to the value array.
   * - For single fields: behaves like a regular text input with a dropdown
   *   suggesting existing options.
   */
  createNewEntry?: boolean | ((query: string) => Exclude<SelectOption, string>);
  /**
   * When true, the dropdown gets a synthetic "none" row at the top that
   * resets the field to `undefined`. Useful for optional filter chips
   * (e.g. an admin-table status filter) where the user needs an explicit
   * "no filter" option — Base UI's `Select` reserves empty-string values
   * as its internal no-selection sentinel, so a regular `<SelectItem
   * value="">` can't be picked. With `clearable`, ControlSelect uses an
   * internal sentinel and translates it to `undefined` in `onChange`.
   *
   * Currently honored by the static-short `Select` and the searchable
   * Combobox render paths. Ignored by `segmented` (use a real segment
   * for "all" there).
   */
  clearable?: boolean;
  /**
   * Label rendered for the "clear" row injected by `clearable`. Also
   * used as the trigger placeholder when the field is empty. Defaults to
   * `"None"`. Localize at the call site (e.g. `"All types"`,
   * `"All status"`).
   */
  clearLabel?: string;
  /**
   * Trigger text for a multi-select whose selection is too long to name, e.g.
   * `(n) => \`${n} status\``. One selection always shows the value itself, so
   * this is only ever asked for two or more past `maxTriggerLength`. Defaults
   * to `"{n} values"`.
   */
  countLabel?: (count: number) => string;
  /**
   * The longest joined text, in characters, a multi-select trigger names its
   * selection with ("Draft, Ready") before it collapses to `countLabel`.
   * Defaults to 20, which suits a filter chip; a full-width form field has
   * room for more.
   */
  maxTriggerLength?: number;
  /**
   * Trigger text when nothing is selected, e.g. "Pick an epic…". Defaults to
   * the `clearLabel` on a `clearable` or multi field (where empty IS a
   * meaningful state to name), and to "Select…" otherwise.
   *
   * Set it when the empty trigger has a job to do - a picker whose whole
   * purpose is the choice it prompts for reads as a dead "Select…" without
   * it, which is why the surfaces that needed one stayed on the raw `Select`.
   */
  placeholder?: string;
  /**
   * Extra className applied to the visible trigger: the combobox button or
   * the segmented control, whichever this field renders. Useful for sizing
   * filter chips (`"w-40"`, `"w-72"`, etc.) without wrapping the whole
   * `FormField` in an extra div.
   */
  triggerClassName?: string;
  /**
   * Trigger height and type scale. Defaults to `default`.
   */
  size?: ControlSelectSize;
  /**
   * Render the trigger borderless and transparent, so it reads as the row it
   * sits on rather than as a form field.
   */
  minimal?: boolean;
  /**
   * Extra attributes for whichever trigger this field renders, forwarded from
   * `Control`'s `inputProps`.
   *
   * The accessible name usually lives here, because a filter is routinely
   * rendered with `label=""` next to its own heading: with no `<label>` to
   * borrow a name from, a `role=combobox` button or a radiogroup has no name
   * at all. That is both an a11y hole and unaddressable from a
   * test, and it was silent, since `Control` accepted `inputProps` and then
   * dropped it on every select-shaped branch.
   */
  triggerProps?: HTMLAttributes<HTMLElement>;
  /**
   * Leading icon rendered on the left of the trigger, matching the
   * text-input controls. Resolved by the parent `Control` from its `icon`
   * prop — unlike text inputs there is no schema-hint fallback, so a select
   * only shows an icon when one is explicitly set.
   */
  icon?: IconComponent;
  /**
   * Drawn at the top of the popup, above the options - for a setting that
   * changes what the choice MEANS rather than what is chosen, such as a
   * filter's "is / is not".
   *
   * ⚠️ Only the combobox shape has a popup, so a segmented or radio rendering
   * of the same field draws nothing for it.
   */
  popupHeader?: ReactNode;
  /**
   * Drawn on the trigger just before the selected label, after the icon: the
   * short word that keeps a qualified value from reading as a plain one
   * ("not Active"). Absent while nothing is selected, because a qualifier on
   * a placeholder has nothing to qualify.
   */
  triggerPrefix?: ReactNode;
  /**
   * Extra className on the popup, merged over its own.
   *
   * The popup is sized from its trigger by default (`--anchor-width`), and it
   * keeps following that width while open. A trigger whose text changes as
   * the reader picks - a `triggerPrefix` appearing, "2 values" replacing a
   * name - therefore resizes the popup under their cursor. `w-max` with a
   * floor (`w-max min-w-48`) sizes it from its own content instead.
   */
  popupClassName?: string;
}

export const ControlSelect = (props: ControlSelectProps) => {
  const { tr } = useI18n();
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const isArray = meta.isArray;
  const isNumeric = meta.type === "number" || meta.type === "integer";
  const isBoolean = meta.type === "boolean";

  // Normalize items prop: array → static; function → loader
  const itemsArray = Array.isArray(props.items)
    ? (props.items as SelectOption[])
    : undefined;
  const itemsLoader =
    typeof props.items === "function"
      ? (props.items as (q: string) => Async<SelectOption[]>)
      : undefined;

  const enumValues =
    itemsArray ?? (meta.enum as SelectOption[] | undefined) ?? [];

  const effectiveLoader = props.loader ?? itemsLoader;

  const {
    data: asyncData,
    loading,
    mode,
    search,
  } = useAsyncLoader(
    effectiveLoader,
    props.loaderThreshold ?? 100,
    props.loaderDebounce ?? 300,
    props.input.initialValue,
  );

  // Labels and `disabled` flags are part of the identity: keying on the
  // joined values alone collided (`["ab","c"]` vs `["a","bc"]`) and kept a
  // stale list when only the labels changed.
  //
  // ⚠️ `icon` is EXCLUDED, and it has to be. It is a `ReactNode`, and a
  // rendered element holds a fiber that points back at its DOM node, so
  // `JSON.stringify` on the raw option threw "Converting circular structure
  // to JSON" - a documented prop that crashed the component the first time
  // anyone used it (#Q2049). Two lists that differ only by icon share a key,
  // which is right: the key exists to notice a changed VALUE or LABEL.
  const enumKey = JSON.stringify(
    enumValues.map((option) =>
      typeof option === "string"
        ? option
        : {
            value: option.value,
            label: option.label,
            description: option.description,
            tag: option.tag,
            disabled: option.disabled,
          },
    ),
  );
  const min = meta.constraints.minimum;
  const max = meta.constraints.maximum;
  // Derived, not stored: this is a pure function of the schema. As state
  // filled in by an effect, the first paint of every boolean or ranged select
  // was an EMPTY list, corrected one render later.
  const staticData = useMemo<SelectOption[]>(() => {
    if (effectiveLoader) return [];
    if (isBoolean && enumValues.length === 0) {
      return [
        { value: "true", label: tr("controlSelect.yes", { default: "Yes" }) },
        { value: "false", label: tr("controlSelect.no", { default: "No" }) },
      ];
    }
    if (
      isNumeric &&
      enumValues.length === 0 &&
      typeof min === "number" &&
      typeof max === "number" &&
      max - min <= 20
    ) {
      const range: SelectOption[] = [];
      for (let i = min; i <= max; i++) range.push(String(i));
      return range;
    }
    return enumValues;
  }, [effectiveLoader, enumKey, isBoolean, isNumeric, min, max, tr]);

  const data = effectiveLoader ? asyncData : staticData;

  if (!props.input?.props) return null;

  const coerce = (raw: string): unknown => {
    if (isNumeric) return Number(raw);
    if (isBoolean) return raw === "true";
    return raw;
  };

  if (props.segmented) {
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        {/* `triggerProps` is deliberately NOT spread here. `Segmented`
            redeclares two attributes that `HTMLAttributes` also has, with
            narrower types (`defaultValue` is string-only, `onChange` takes a
            value rather than an event), so a blanket spread neither typechecks
            nor is safe. A segmented field also renders every option as visible
            text, so it is the one branch that is not nameless without a label.
            Name it with `label` if it needs one. */}
        <Segmented
          value={value != null ? String(value) : undefined}
          onChange={(v) => setValue(coerce(v))}
          disabled={props.disabled}
          options={data.slice(0, 10).map((o) => ({
            value: optValue(o),
            label: segmentedLabel(o),
          }))}
          fullWidth
        />
      </FormField>
    );
  }

  const clearLabel =
    props.clearLabel ?? tr("controlSelect.none", { default: "None" });

  // One control for every list. The option count decides whether the popup
  // carries a search field — it no longer decides which primitive renders.
  // The native `Select` path this replaced silently dropped `description`,
  // `tag`, per-option `disabled` and `deselectable`, and styled its trigger
  // differently, purely because a list happened to be short.
  // A search field is offered only when scanning the list by eye stops being
  // realistic: a server-driven list (whose rows are not all here), one past
  // `SEARCH_THRESHOLD`, or one where typing is how a new entry is made.
  //
  // Multi-select used to force it on unconditionally, because the chips box
  // WAS the search input and there was no other way to open the popup. The
  // trigger is a button now, so multi obeys the same rule as everything else
  // and a four-row status filter no longer opens onto a search field.
  const searchable =
    props.searchable ??
    (props.combobox ||
      mode === "long" ||
      Boolean(props.createNewEntry) ||
      data.length > SEARCH_THRESHOLD);

  return (
    <FormField
      id={meta.id}
      label={meta.label}
      description={meta.description}
      error={meta.error}
      required={meta.required}
    >
      <ControlSelectCombobox
        id={meta.id}
        data={data}
        loading={loading}
        multi={isArray}
        searchable={searchable}
        disabled={props.disabled}
        value={value}
        onChange={(v) => setValue(v)}
        coerce={coerce}
        onSearch={mode === "long" ? search.run : undefined}
        createNewEntry={props.createNewEntry}
        icon={props.icon}
        // Used to be dropped on this path, so a filter chip sized `w-40` lost
        // its width as soon as its list crossed the threshold.
        triggerClassName={props.triggerClassName}
        triggerProps={props.triggerProps}
        size={props.size}
        minimal={props.minimal}
        // `clearable` used to reach this path as a placeholder and nothing
        // else, so a filter chip that had switched to the combobox (>20
        // options) could be set but never put back to "All …".
        clearable={props.clearable}
        clearLabel={clearLabel}
        countLabel={props.countLabel}
        maxTriggerLength={props.maxTriggerLength}
        popupHeader={props.popupHeader}
        triggerPrefix={props.triggerPrefix}
        popupClassName={props.popupClassName}
        // An optional field must also be able to go back to empty without a
        // dedicated row: Base UI never emits `null`, so re-pressing the
        // selected row deselects (see `handleSingle` in
        // `ControlSelectCombobox.tsx`). A required field keeps its value —
        // clearing it would only produce a validation error the user cannot
        // see yet.
        deselectable={props.clearable || !meta.required}
        // Multi shows this muted when nothing is picked, so it reaches the
        // trigger whether or not the field is `clearable` — a multi-select
        // has no clear ROW (it clears by deselecting), and without this its
        // empty trigger fell back to a bare "Select…".
        placeholder={
          props.placeholder ??
          (props.clearable || isArray ? clearLabel : undefined)
        }
      />
    </FormField>
  );
};

export type SelectOption =
  | string
  | {
      value: string;
      label: string;
      /**
       * Optional secondary line shown under the label in the dropdown.
       */
      description?: string;
      /**
       * Optional small badge rendered next to the label.
       */
      tag?: string;
      /**
       * Optional icon/element rendered before the label, in both the
       * dropdown row and (for single-select) the trigger when selected.
       */
      icon?: ReactNode;
      /**
       * When true, the row is non-interactive — can't be selected if
       * not selected, can't be deselected if selected. Useful for
       * default/mandatory entries (e.g. the base "user" role).
       */
      disabled?: boolean;
    };

type LoaderMode = "static" | "short" | "long";

/**
 * How tall and how loud a select trigger is.
 *
 * The kit's own scale, kept under this name because `Control` and a long tail
 * of callers already spell it `size="xs"` on a select. The table behind it,
 * and the trigger box it sizes, are `control-base/field-trigger`'s - shared
 * with the two calendar controls, which used to draw a button instead.
 */
export type ControlSelectSize = ControlTriggerSize;

/**
 * Static option count above which the dropdown grows a search input. Below it
 * the very same combobox renders without one — the threshold decides whether
 * you can type, never which control you get.
 */
// Past this many rows, scanning by eye stops being realistic and the popup
// grows a search field. Raised 20 -> 50 with the multi-select rework: the old
// value put a search box on lists a reader takes in at a glance.
const SEARCH_THRESHOLD = 50;

/**
 * Friendly label for plain string options: "optional" → "Optional",
 * "in_progress" → "In Progress". Custom `{ value, label }` items pass through
 * untouched.
 */
const titlecase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
/**
 * What one segment shows.
 *
 * ⚠️ The option's `icon` is rendered HERE rather than dropped, which is what
 * this path did until #Q2049. `SegmentedOption.label` is a `ReactNode`, so
 * there was never a reason for it: an option list carrying icons for the
 * dropdown carried them for the segments too, and dropping them silently
 * made a caller choose between two shapes for one list.
 */
const segmentedLabel = (o: SelectOption): ReactNode => {
  if (typeof o === "string") {
    return titlecase(o);
  }
  if (!o.icon) {
    return o.label;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {o.icon}
      {o.label}
    </span>
  );
};

const useAsyncLoader = (
  loader: ControlSelectProps["loader"],
  threshold: number,
  debounceMs: number,
  defaultValue: unknown,
) => {
  const [data, setData] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoaderMode>("static");
  const cache = useRef(new Map<string, SelectOption[]>());

  useAction(
    {
      // `id`, not `name`: `id` is what useAction threads into its
      // react:action:* events. `name` was accepted and never read, so this
      // identifier reached nothing.
      id: "select:loader:init",
      runOnInit: true,
      handler: async () => {
        if (!loader) {
          setMode("static");
          return;
        }
        setLoading(true);
        try {
          const result = await loader("");
          const isShort = result.length <= threshold;
          setMode(isShort ? "short" : "long");
          cache.current.set("", result);
          setData(result);

          // Coercion at a boundary: the value is a form/route/chart primitive whose
          // declared type is wider than what can reach here.
          // oxlint-disable-next-line typescript/no-base-to-string -- a coercion at a boundary, see the comment above
          if (!isShort && defaultValue != null && String(defaultValue) !== "") {
            // Coercion at a boundary: the value is a form/route/chart primitive whose
            // declared type is wider than what can reach here.
            // oxlint-disable-next-line typescript/no-base-to-string -- a coercion at a boundary, see the comment above
            const resolved = await loader("", [String(defaultValue)]);
            if (resolved.length > 0) {
              setData((prev) => {
                const existing = new Set(prev.map(optValue));
                const fresh = resolved.filter(
                  (r) => !existing.has(optValue(r)),
                );
                return [...prev, ...fresh];
              });
            }
          }
        } finally {
          setLoading(false);
        }
      },
    },
    [loader, threshold],
  );

  const search = useAction<[string]>(
    {
      debounce: debounceMs,
      handler: async (text) => {
        if (!loader || mode !== "long") return;
        if (cache.current.has(text)) {
          setData(cache.current.get(text)!);
          return;
        }
        setLoading(true);
        try {
          const result = await loader(text);
          cache.current.set(text, result);
          setData(result);
        } finally {
          setLoading(false);
        }
      },
    },
    [loader, mode, debounceMs],
  );

  return { data, loading, mode, search };
};
