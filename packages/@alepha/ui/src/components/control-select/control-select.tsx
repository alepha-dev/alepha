import * as React from "react";

void React;

import { FormField } from "@alepha/ui/components/control-base/form-field";
import type { IconComponent } from "@alepha/ui/components/control-base/icon-hint";
import {
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Combobox as ComboboxRoot,
  ComboboxTrigger,
  useComboboxAnchor,
} from "@alepha/ui/components/ui/combobox";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import type { Async } from "alepha";
import { useAction } from "alepha/react";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

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
   * Whether the dropdown carries a search input. Defaults to "auto": on for
   * multi-select, for a long-mode `loader`, and for static lists longer than
   * `SEARCH_THRESHOLD`. Set explicitly to search a short list or to drop the
   * search field from a long one.
   */
  searchable?: boolean;
  /**
   * Async option loader. Triggers long-mode (server-side search) above `loaderThreshold` options.
   */
  loader?: (search: string, resolve?: string[]) => Async<SelectOption[]>;
  /**
   * Option count above which `loader` is invoked on every search instead of once. Defaults to ~50.
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
   * Extra className applied to the visible trigger (the `<SelectTrigger>`
   * or combobox `<Button>`). Useful for sizing filter chips
   * (`"w-40"`, `"w-72"`, etc.) without wrapping the whole `FormField` in
   * an extra div.
   */
  triggerClassName?: string;
  /**
   * Leading icon rendered on the left of the trigger, matching the
   * text-input controls. Resolved by the parent `Control` from its `icon`
   * prop — unlike text inputs there is no schema-hint fallback, so a select
   * only shows an icon when one is explicitly set.
   */
  icon?: IconComponent;
}

/**
 * Internal sentinel for the `clearable` row. Picked to be unlikely to
 * collide with a real option value; we translate it to `undefined` at
 * the boundary so callers never see it.
 */
const CLEAR_VALUE = "__alepha_clear__";

/**
 * Static option count above which the dropdown grows a search input. Below it
 * the very same combobox renders without one — the threshold decides whether
 * you can type, never which control you get.
 */
const SEARCH_THRESHOLD = 20;

const optValue = (o: SelectOption) => (typeof o === "string" ? o : o.value);
const optLabel = (o: SelectOption) => (typeof o === "string" ? o : o.label);
const optDesc = (o: SelectOption) =>
  typeof o === "string" ? undefined : o.description;
const optTag = (o: SelectOption) => (typeof o === "string" ? undefined : o.tag);
const optDisabled = (o: SelectOption) =>
  typeof o === "string" ? false : Boolean(o.disabled);
const optIcon = (o: SelectOption): ReactNode =>
  typeof o === "string" ? undefined : o.icon;

/**
 * Friendly label for plain string options: "optional" → "Optional",
 * "in_progress" → "In Progress". Custom `{ value, label }` items pass through
 * untouched.
 */
const titlecase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const segmentedLabel = (o: SelectOption) =>
  typeof o === "string" ? titlecase(o) : o.label;

export function ControlSelect(props: ControlSelectProps) {
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

  const [staticData, setStaticData] = useState<SelectOption[]>([]);
  const enumKey = enumValues.map(optValue).join("");
  const min = meta.constraints.minimum;
  const max = meta.constraints.maximum;
  useEffect(() => {
    if (effectiveLoader) return;
    if (isBoolean && enumValues.length === 0) {
      setStaticData([
        { value: "true", label: tr("controlSelect.yes", { default: "Yes" }) },
        { value: "false", label: tr("controlSelect.no", { default: "No" }) },
      ]);
    } else if (
      isNumeric &&
      enumValues.length === 0 &&
      typeof min === "number" &&
      typeof max === "number" &&
      max - min <= 20
    ) {
      const range: SelectOption[] = [];
      for (let i = min; i <= max; i++) range.push(String(i));
      setStaticData(range);
    } else {
      setStaticData(enumValues);
    }
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
  // Multi-select is never search-less: the chips input IS its trigger.
  const searchable =
    isArray ||
    (props.searchable ??
      (props.combobox || mode === "long" || data.length > SEARCH_THRESHOLD));

  return (
    <FormField
      id={meta.id}
      label={meta.label}
      description={meta.description}
      error={meta.error}
      required={meta.required}
    >
      <Combobox
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
        // `clearable` used to reach this path as a placeholder and nothing
        // else, so a filter chip that had switched to the combobox (>20
        // options) could be set but never put back to "All …".
        clearable={props.clearable}
        clearLabel={clearLabel}
        // An optional field must also be able to go back to empty without a
        // dedicated row: Base UI never emits `null`, so re-pressing the
        // selected row deselects (see `handleSingle`). A required field keeps
        // its value — clearing it would only produce a validation error the
        // user cannot see yet.
        deselectable={props.clearable || !meta.required}
        placeholder={props.clearable ? clearLabel : undefined}
      />
    </FormField>
  );
}

interface ComboboxProps {
  id?: string;
  data: SelectOption[];
  loading: boolean;
  multi: boolean;
  /**
   * Render the search input. When false the popup is the list alone — the
   * shape a short static list gets. Multi-select ignores it: its input is the
   * chips box itself, and it is the only way to open and type.
   */
  searchable: boolean;
  disabled?: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
  coerce: (v: string) => unknown;
  onSearch?: (q: string) => void;
  createNewEntry?: ControlSelectProps["createNewEntry"];
  icon?: IconComponent;
  triggerClassName?: string;
  /**
   * Trigger text when nothing is selected. Mirrors the native-Select path,
   * where a `clearable` field shows its `clearLabel` (e.g. "All zones") as the
   * empty placeholder. Defaults to "Select…".
   */
  placeholder?: string;
  /**
   * Prepend a row that resets the field to `undefined` — the combobox
   * equivalent of the native `Select`'s clear row.
   */
  clearable?: boolean;
  /**
   * Label of the `clearable` row (e.g. "All zones").
   */
  clearLabel?: string;
  /**
   * Allow the single-select value to be unset by pressing the row that is
   * already selected. Set for optional (and `clearable`) fields only.
   */
  deselectable?: boolean;
}

/**
 * Normalized option used as the Base UI `Combobox.Item` value. Because the
 * shape is `{ value, label }`, Base UI uses `label` for display/search and
 * `value` for selection automatically — which is what makes the popup search
 * match the visible label rather than the raw id.
 */
interface ComboOption {
  value: string;
  label: string;
  description?: string;
  tag?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /**
   * Marks the synthetic "create new" row injected by `createNewEntry`.
   */
  create?: boolean;
  /**
   * Marks the synthetic "clear" row injected by `clearable`.
   */
  clear?: boolean;
  /**
   * The raw query that produced a `create` row (used as the new entry's label).
   */
  query?: string;
}

/**
 * Searchable single/multi select built on the Base UI `Combobox` primitive.
 *
 * Composed in the "select-like" shape: a button trigger that shows the current
 * value, with the search `<input>` living inside the popup. We disable Base
 * UI's internal filtering (`filter={null}`) and filter in JS so the same code
 * path serves static lists, server-driven (`onSearch`) lists, and the
 * `createNewEntry` affordance.
 */
function Combobox(props: ComboboxProps) {
  const { tr } = useI18n();
  const [query, setQuery] = useState("");
  // Remembers labels for values the user has picked, so the trigger/chips keep
  // a human label even after the source option drops out of a server-filtered
  // `data` set — or for freshly created entries that never existed in `data`.
  const labelCache = useRef(new Map<string, string>());
  // Positioning anchor for the multi-select chips box (the popup is anchored to
  // the chips container rather than the inline input).
  const anchor = useComboboxAnchor();

  const options: ComboOption[] = props.data.map((o) => ({
    value: optValue(o),
    label: optLabel(o),
    description: optDesc(o),
    tag: optTag(o),
    icon: optIcon(o),
    disabled: optDisabled(o),
  }));

  const selected: string[] = props.multi
    ? Array.isArray(props.value)
      ? (props.value as unknown[]).map(String)
      : []
    : props.value != null
      ? [String(props.value)]
      : [];

  const labelFor = (val: string) =>
    options.find((o) => o.value === val)?.label ??
    labelCache.current.get(val) ??
    val;

  const disabledFor = (val: string) =>
    options.find((o) => o.value === val)?.disabled ?? false;

  // Server mode (`onSearch`) filters upstream; for static lists we filter on
  // the visible label — never the value/id (that was the cmdk bug).
  const serverMode = Boolean(props.onSearch);
  const q = query.trim().toLowerCase();
  const filtered =
    serverMode || !q
      ? options
      : options.filter((o) => o.label.toLowerCase().includes(q));

  const showCreate =
    Boolean(props.createNewEntry) &&
    q.length > 0 &&
    !options.some((o) => o.value === query || o.label.toLowerCase() === q) &&
    !selected.includes(query);

  const createOption: ComboOption | undefined = showCreate
    ? (() => {
        const built =
          typeof props.createNewEntry === "function"
            ? props.createNewEntry(query)
            : { value: query, label: query };
        return {
          value: built.value,
          label: built.label,
          create: true,
          query,
        };
      })()
    : undefined;

  // The synthetic "no selection" row — "All zones", "All tags", "None". Only
  // meaningful for a single select: the multi path clears by removing chips.
  const clearRow: ComboOption | undefined =
    props.clearable && !props.multi
      ? {
          value: CLEAR_VALUE,
          label:
            props.clearLabel ?? tr("controlSelect.none", { default: "None" }),
          clear: true,
        }
      : undefined;
  // Filtered on its own label like any other row, so searching "zone" doesn't
  // leave "All zones" stranded at the top of a list it doesn't match.
  const showClear = clearRow && clearRow.label.toLowerCase().includes(q);

  const items: ComboOption[] = [
    ...(showClear && clearRow ? [clearRow] : []),
    ...filtered,
    ...(createOption ? [createOption] : []),
  ];

  // Reconstruct option objects for the controlled value. Base UI matches them
  // back to list items via `isItemEqualToValue` (by `value`), so identity
  // across renders doesn't matter.
  const toValueObject = (val: string): ComboOption =>
    options.find((o) => o.value === val) ?? {
      value: val,
      label: labelFor(val),
    };

  const cbValue = props.multi
    ? selected.map(toValueObject)
    : selected[0]
      ? toValueObject(selected[0])
      : // Empty + clearable reads as "the clear row is what's selected", so it
        // carries the check mark — same as the native `Select` path.
        (clearRow ?? null);

  const remember = (o: ComboOption) => {
    if (o.create) labelCache.current.set(o.value, o.query ?? o.value);
    else labelCache.current.set(o.value, o.label);
  };

  const handleSingle = (o: ComboOption | null) => {
    if (!o || o.clear) {
      props.onChange(undefined);
      setQuery("");
      return;
    }
    // Base UI's single-select `Combobox` re-selects on every item press — its
    // `handleSelection` calls `setSelectedValue(itemValue)` unconditionally and
    // never emits `null` — so pressing the checked row was a no-op and an
    // optional field had no way back to empty. Toggle it off here, the way the
    // multi path already does via its chips.
    if (props.deselectable && !o.create && selected[0] === o.value) {
      props.onChange(undefined);
      setQuery("");
      return;
    }
    remember(o);
    props.onChange(props.coerce(o.value));
    setQuery("");
  };

  const handleMulti = (list: ComboOption[]) => {
    for (const o of list) remember(o);
    props.onChange(list.map((o) => props.coerce(o.value)));
    setQuery("");
  };

  const emptyLabel =
    props.placeholder ?? tr("controlSelect.select", { default: "Select…" });
  const triggerLabel = selected[0] ? labelFor(selected[0]) : emptyLabel;

  // The list (loading / empty / items) is identical for single and multi — only
  // the trigger differs (button vs. chips box), so render it once.
  const popupBody = props.loading ? (
    <div className="text-muted-foreground flex items-center justify-center gap-2 p-4 text-sm">
      <Loader2 className="size-4 animate-spin" />{" "}
      {tr("controlSelect.loading", { default: "Loading…" })}
    </div>
  ) : (
    <>
      <ComboboxEmpty>
        {props.createNewEntry
          ? ""
          : tr("controlSelect.noResults", { default: "No results." })}
      </ComboboxEmpty>
      <ComboboxList>
        {(opt: ComboOption) =>
          opt.create ? (
            <ComboboxItem key={`__create__${opt.value}`} value={opt}>
              <span className="mr-2">+</span>
              {tr("controlSelect.create", {
                default: `Create "${opt.query}"`,
                args: [String(opt.query ?? "")],
              })}
            </ComboboxItem>
          ) : (
            <ComboboxItem key={opt.value} value={opt} disabled={opt.disabled}>
              {opt.icon && (
                <span className="mr-2 flex shrink-0 items-center">
                  {opt.icon}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1.5">
                  {opt.tag && (
                    <span className="bg-muted text-muted-foreground rounded px-1 text-[10px] uppercase tracking-wide">
                      {opt.tag}
                    </span>
                  )}
                  <span className="truncate">{opt.label}</span>
                </div>
                {opt.description && (
                  <span className="text-muted-foreground text-xs truncate">
                    {opt.description}
                  </span>
                )}
              </div>
            </ComboboxItem>
          )
        }
      </ComboboxList>
    </>
  );

  return (
    <ComboboxRoot
      items={items as never}
      multiple={props.multi}
      disabled={props.disabled}
      value={cbValue as never}
      onValueChange={
        (props.multi
          ? (v: ComboOption[]) => handleMulti(v)
          : (v: ComboOption | null) => handleSingle(v)) as never
      }
      isItemEqualToValue={
        ((a: ComboOption, b: ComboOption) => a.value === b.value) as never
      }
      filter={null}
      // Base UI leaves `autoHighlight` off by default, so nothing is
      // highlighted while typing and Enter has no target — the user has to
      // click a row (including the `createNewEntry` one). Highlighting the
      // first match makes Enter pick it, which is what a search field is
      // expected to do. It only engages while the query is non-empty, so
      // opening the popup still starts with no preselection.
      autoHighlight
      onInputValueChange={(v) => {
        setQuery(v);
        props.onSearch?.(v);
      }}
    >
      {props.multi ? (
        // Multi-select: removable chips for each value with an inline search
        // input, all inside the bordered chips box (Base UI's native shape).
        <>
          <ComboboxChips
            ref={anchor}
            id={props.id}
            className={cn(
              "w-full",
              props.disabled && "pointer-events-none opacity-50",
              props.triggerClassName,
            )}
          >
            {props.icon && (
              <props.icon className="text-muted-foreground ml-1 size-4 shrink-0" />
            )}
            {selected.map((val) => (
              <ComboboxChip key={val} showRemove={!disabledFor(val)}>
                {labelFor(val)}
              </ComboboxChip>
            ))}
            <ComboboxChipsInput
              placeholder={
                selected.length === 0
                  ? (props.placeholder ?? "Search…")
                  : "Search…"
              }
            />
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>{popupBody}</ComboboxContent>
        </>
      ) : (
        // Single-select: a button trigger styled to mirror <SelectTrigger>,
        // with the search input inside the popup.
        <>
          <ComboboxTrigger
            id={props.id}
            disabled={props.disabled}
            className={cn(
              "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
              // Muted means "nothing chosen yet", which is only true without
              // a clear row. WITH one, empty is a selected value — the popup
              // already puts the check mark on it (see `cbValue`), and the
              // native `Select` path renders the same state in full contrast
              // because it makes the clear label a genuine `selectedValue`.
              // Muting here made one `clearable` filter look unset and its
              // neighbour look set for the same meaning, purely because the
              // option count crossed the 20 that picks between the two paths.
              selected.length === 0 &&
                !props.clearable &&
                "text-muted-foreground",
              props.triggerClassName,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {props.icon && (
                <props.icon className="text-muted-foreground size-4 shrink-0" />
              )}
              <span className="truncate">{triggerLabel}</span>
            </span>
          </ComboboxTrigger>
          <ComboboxContent>
            {props.searchable && (
              <ComboboxInput showTrigger={false} placeholder="Search…" />
            )}
            {popupBody}
          </ComboboxContent>
        </>
      )}
    </ComboboxRoot>
  );
}

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

          if (!isShort && defaultValue != null && String(defaultValue) !== "") {
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
