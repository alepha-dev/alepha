import * as React from "react";

void React;

import { FormField } from "@alepha/ui/components/control-base/form-field";
import type { IconComponent } from "@alepha/ui/components/control-base/icon-hint";
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Combobox as ComboboxRoot,
  ComboboxTrigger,
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
import { ListChecks, Loader2, X } from "lucide-react";
import type { HTMLAttributes } from "react";
import { type ReactNode, useMemo, useRef, useState } from "react";

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
 * `xs` exists for a control that sits ON a row of text rather than in a form:
 * the quest rail's Release field beside its Assigned picker, where a
 * default-height boxed select reads as heavier than every line around it.
 */
export type ControlSelectSize = "xs" | "sm" | "default";

/**
 * Per-size trigger geometry. Kept as one table rather than scattered
 * conditionals so a new size is one row and the axes cannot drift.
 *
 * `chevron` targets the trigger's own last SVG - the one `ComboboxTrigger`
 * appends at a hardcoded `size-4`. That file is stock shadcn, refreshed
 * wholesale by `yarn sync`, so it is sized from here rather than edited.
 *
 * ⚠️ `clear` and `clearGap` are in this table for the reason feedback #2113
 * exists: they used to be the constants `right-8` and `mr-6`, tuned for the
 * default size. `right-8` is the default's right padding (8px) plus its
 * chevron (16px) plus a gap, so at `sm` and `xs` - where both shrink - the
 * `x` stayed 32px from the edge while the chevron moved left, and it landed
 * on the value. Anything positioned against the chevron belongs beside the
 * chevron's own size.
 *
 * - `clear` is the button's offset from the trigger's right edge.
 * - `clearGap` is the margin that stops the LABEL running under it. On the
 *   label rather than in the trigger's padding: the chevron is the trigger's
 *   last flex child under `justify-between`, so padding the trigger walks
 *   the chevron inwards and leaves the button hanging off its right.
 */
const SIZE_CLASSES: Record<
  ControlSelectSize,
  {
    trigger: string;
    icon: string;
    chevron: string;
    clear: string;
    clearGap: string;
  }
> = {
  default: {
    trigger: "h-8 gap-1.5 py-2 pr-2 pl-2.5 text-sm",
    icon: "size-4",
    chevron: "[&>svg]:size-4",
    clear: "right-8",
    clearGap: "mr-6",
  },
  sm: {
    trigger: "h-7 gap-1.5 py-1 pr-1.5 pl-2 text-sm",
    icon: "size-3.5",
    chevron: "[&>svg]:size-3.5",
    clear: "right-7",
    clearGap: "mr-5",
  },
  xs: {
    trigger: "h-6 gap-1 px-1 text-xs",
    icon: "size-3",
    chevron: "[&>svg]:size-3",
    clear: "right-5",
    clearGap: "mr-4",
  },
};

/**
 * What `minimal` does to the clear button's offset.
 *
 * `MINIMAL_CLASSES` carries `-mx-1`, so the trigger's right edge sits 4px
 * PAST the wrapper the button is positioned against, taking the chevron with
 * it. The button has to follow by the same 4px or it drifts left of where it
 * belongs - a second copy of the bug this quest is about, one variant down.
 *
 * A translate rather than a second `right-*` per size, so the table stays one
 * number per size and this stays one rule.
 */
const MINIMAL_CLEAR_SHIFT = "translate-x-1";

/**
 * The bordered box, or nothing at all.
 *
 * `minimal` drops the border, the background and the shadow, and pulls the
 * trigger left by its own padding so its text aligns with plain rows beside
 * it. The hover tint is what keeps it discoverable as a control.
 */
const MINIMAL_CLASSES =
  "-mx-1 border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-input/50";

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
   * Trigger text for a multi-select holding two or more values, e.g.
   * `(n) => \`${n} status\``. One selection always shows the value itself, so
   * this is only ever asked for the collapsed case. Defaults to
   * `"{n} selected"`.
   */
  countLabel?: (count: number) => string;
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
}

/**
 * Internal sentinel for the "select every match" row. Same reasoning as
 * `CLEAR_VALUE`: it never reaches a caller, because it is expanded into the
 * matching values before `onChange` is called.
 */
const SELECT_ALL_VALUE = "__alepha_select_all__";

/**
 * Static option count above which the dropdown grows a search input. Below it
 * the very same combobox renders without one — the threshold decides whether
 * you can type, never which control you get.
 */
// Past this many rows, scanning by eye stops being realistic and the popup
// grows a search field. Raised 20 -> 50 with the multi-select rework: the old
// value put a search box on lists a reader takes in at a glance.
const SEARCH_THRESHOLD = 50;

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
  const enumKey = JSON.stringify(enumValues);
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
        triggerProps={props.triggerProps}
        size={props.size}
        minimal={props.minimal}
        // `clearable` used to reach this path as a placeholder and nothing
        // else, so a filter chip that had switched to the combobox (>20
        // options) could be set but never put back to "All …".
        clearable={props.clearable}
        clearLabel={clearLabel}
        countLabel={props.countLabel}
        // An optional field must also be able to go back to empty without a
        // dedicated row: Base UI never emits `null`, so re-pressing the
        // selected row deselects (see `handleSingle`). A required field keeps
        // its value — clearing it would only produce a validation error the
        // user cannot see yet.
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
   * Trigger height and type scale. Defaults to `default`.
   */
  size?: ControlSelectSize;
  /**
   * Render the trigger borderless and transparent, so it reads as the row it
   * sits on rather than as a form field.
   */
  minimal?: boolean;
  triggerProps?: HTMLAttributes<HTMLElement>;
  /**
   * Trigger text when nothing is selected. Mirrors the native-Select path,
   * where a `clearable` field shows its `clearLabel` (e.g. "All zones") as the
   * empty placeholder. Defaults to "Select…".
   */
  placeholder?: string;
  /**
   * Empty is a meaningful choice for this field, so say so and offer it: the
   * trigger shows {@link clearLabel} while nothing is selected, and carries
   * an `x` to get back there once something is.
   *
   * ⚠️ It used to PREPEND A ROW saying the same thing, which is why the two
   * names still read that way at some call sites. That row was drawn as a
   * pickable option with a check mark, so "All states" looked like a third
   * state rather than the absence of a filter (feedback #2098).
   */
  clearable?: boolean;
  /**
   * What empty is called on this field (e.g. "All zones"), shown as the
   * trigger's placeholder.
   */
  clearLabel?: string;
  /**
   * See `ControlSelectProps.countLabel`.
   */
  countLabel?: (count: number) => string;
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
   * Marks the synthetic "select every match" row a multi-select offers while
   * a query is narrowing the list.
   */
  selectAll?: boolean;
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
  const sizeClasses = SIZE_CLASSES[props.size ?? "default"];
  const [query, setQuery] = useState("");
  // Remembers labels for values the user has picked, so the trigger/chips keep
  // a human label even after the source option drops out of a server-filtered
  // `data` set — or for freshly created entries that never existed in `data`.
  const labelCache = useRef(new Map<string, string>());

  const dataOptions: ComboOption[] = props.data.map((o) => ({
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
      ? // Coercion at a boundary: the value is a form/route/chart primitive whose
        // declared type is wider than what can reach here.
        // oxlint-disable-next-line typescript/no-base-to-string
        [String(props.value)]
      : [];

  const labelFor = (val: string) =>
    dataOptions.find((o) => o.value === val)?.label ??
    labelCache.current.get(val) ??
    val;

  /**
   * Rows for values that are selected and have no option to be selected FROM.
   *
   * ⚠️ Without these the popup lists strictly `props.data`, so a selected
   * value absent from it is counted by the trigger, ticked nowhere, and
   * **cannot be deselected from the list it is missing from** (feedback
   * #2115). Two ways in, and the component was already half-aware of both -
   * `labelCache` exists for exactly these values and says so:
   *
   * - **`createNewEntry`.** A created entry never existed in `data`, and the
   *   caller usually cannot add it: the common declaration is a static
   *   `items: [...]` inside a zod `.meta({ $control })`, which has no state
   *   to append to, and `useForm` anchors its schema at mount anyway. So the
   *   feature was broken by construction for every such caller rather than
   *   missing in one demo page.
   * - **`onSearch` / server mode.** The upstream query narrows `data`, so
   *   picking A and then typing something that excludes it takes A's row away
   *   while the trigger still counts it.
   *
   * Labelled through `labelFor`, which is why the cache is read there and not
   * here: a created value's label is whatever was typed, and a server-dropped
   * one's is whatever it had when it was picked.
   *
   * **Pinned above the real options**, rather than interleaved: a created
   * value has no place in the source list's order, and inventing one would
   * imply an ordering `data` does not have.
   */
  const orphans: ComboOption[] = selected
    .filter((val) => !dataOptions.some((o) => o.value === val))
    .map((val) => ({ value: val, label: labelFor(val) }));

  /**
   * What the popup may show: the orphans, then `props.data`.
   *
   * ⚠️ The injection is here rather than in `filtered`, and that is what makes
   * `showCreate` stop offering a Create row for a value that has already been
   * created - its guard reads `options`.
   */
  const options: ComboOption[] = orphans.length
    ? [...orphans, ...dataOptions]
    : dataOptions;

  // Server mode (`onSearch`) filters upstream; for static lists we filter on
  // the visible label — never the value/id (that was the cmdk bug).
  const serverMode = Boolean(props.onSearch);
  const q = query.trim().toLowerCase();
  const matchesQuery = (o: ComboOption) => o.label.toLowerCase().includes(q);

  // ⚠️ An orphan is filtered by the typed query like any other row, which is a
  // DECISION rather than an accident of where the injection happens: a search
  // that kept showing rows it did not match would stop being a search. With an
  // empty query every orphan is shown, which is the case that matters - it is
  // how a created value is deselected.
  //
  // And it is filtered HERE even in server mode. The server narrowed `data`
  // and knows nothing about a row this component invented, so leaving orphans
  // out of the local pass would make the same typed query mean two different
  // things in one list.
  const filtered = [
    ...(q ? orphans.filter(matchesQuery) : orphans),
    ...(serverMode || !q ? dataOptions : dataOptions.filter(matchesQuery)),
  ];

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

  // ⚠️ There is no synthetic "no selection" ROW any more.
  //
  // A `clearable` single-select used to inject one - "All states", "Everyone",
  // "All sigils" - at the top of its list. It said the same thing the trigger
  // already says when the field is empty, a second time, as a pickable option
  // carrying a check mark, so "all" read as a third state a release could be
  // in rather than as the absence of a filter (feedback #2092, then #2098).
  //
  // The empty state is now expressed ONCE, on the trigger, via `clearLabel`
  // as its placeholder. Clearing a chosen value is re-clicking it, which
  // `deselectable` already implements and
  // `control-select-deselect.browser.spec.tsx` already covers.
  //
  // `clearable` therefore no longer adds a row. It still means "this field
  // may be empty": it is what puts `clearLabel` on the trigger and what makes
  // a REQUIRED field deselectable.

  /**
   * "Select every match" — the row that makes a typed prefix a filter clause
   * rather than a way to find one item.
   *
   * Areas are named by import path (`lore/quests`, `lore/folios`, `lore/ui`),
   * so the prefix is the meaningful unit and "everything under lore/" took
   * eight separate picks (feedback #2009). Typing `lore/` and pressing one row
   * is the whole feature.
   *
   * ⚠️ It resolves to the individual values, deliberately, rather than
   * becoming a pattern the query carries. Two consequences, and both are the
   * point: the caller's schema and endpoint are untouched (a list of values is
   * what they already take), and the chips stay honest - what is filtered is
   * exactly what is shown, so removing one of the eight is an ordinary
   * gesture rather than an escape from a prefix.
   *
   * Only when it would do something: multi-select, a non-empty query, and at
   * least two matches that are not already selected. One match is what
   * pressing the row itself does.
   */
  const unselectedMatches = props.multi
    ? filtered.filter((o) => !o.disabled && !selected.includes(o.value))
    : [];

  const selectAllRow: ComboOption | undefined =
    props.multi && q.length > 0 && unselectedMatches.length > 1
      ? {
          value: SELECT_ALL_VALUE,
          label: String(
            tr("controlSelect.selectAll", {
              default: `Select ${unselectedMatches.length} matching "${query}"`,
              args: [String(unselectedMatches.length), query],
            }),
          ),
          selectAll: true,
        }
      : undefined;

  const items: ComboOption[] = [
    ...(selectAllRow ? [selectAllRow] : []),
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
      : // Empty is EMPTY. It used to resolve to the clear row so that row
        // carried a check mark; with no such row, nothing is selected and the
        // trigger shows `clearLabel` as its placeholder.
        null;

  const remember = (o: ComboOption) => {
    if (o.create) labelCache.current.set(o.value, o.query ?? o.value);
    else labelCache.current.set(o.value, o.label);
  };

  const handleSingle = (o: ComboOption | null) => {
    // `null` still arrives from Base UI's own clearing paths (Escape on an
    // open popup, a controlled reset). There is no longer a synthetic clear
    // ROW that could arrive here as an option - the label lives on the
    // trigger and nowhere else since feedback #2098.
    if (!o) {
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
    // The "select every match" row arrives here as one more selected item.
    // Swap it for the values it stands for, so the sentinel never leaves this
    // component and the chips show the real areas rather than a prefix.
    const expanded = list.flatMap((o) =>
      o.selectAll ? unselectedMatches : [o],
    );
    // Base UI can hand the same option back twice when the expansion overlaps
    // something already selected.
    const seen = new Set<string>();
    const unique = expanded.filter((o) =>
      seen.has(o.value) ? false : (seen.add(o.value), true),
    );
    for (const o of unique) remember(o);
    props.onChange(unique.map((o) => props.coerce(o.value)));
    setQuery("");
  };

  const emptyLabel =
    props.placeholder ?? tr("controlSelect.select", { default: "Select…" });

  /**
   * Value, then count.
   *
   * One selection names itself; two or more collapse to a count. That is what
   * keeps a filter row at a FIXED width: chips grew the trigger with every
   * pick and then truncated, so the control both moved its neighbours and
   * stopped saying what it was filtering on. A count does neither, and the
   * single-selection case — much the commonest — still reads as the value.
   */
  const triggerLabel = props.multi
    ? selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? labelFor(selected[0])
        : (props.countLabel?.(selected.length) ??
          String(
            tr("controlSelect.count", {
              default: `${selected.length} selected`,
              args: [String(selected.length)],
            }),
          ))
    : selected[0]
      ? labelFor(selected[0])
      : emptyLabel;

  /**
   * The `x` that puts a `clearable` field back to empty in one click.
   *
   * ⚠️ This is the affordance the injected clear ROW used to be, moved to
   * where it belongs (feedback #2098). Deleting the row made the empty state
   * a placeholder rather than a third pickable value, which is what the
   * report asked for.
   *
   * ## Why the `x` and not the row, stated properly
   *
   * An earlier version of this comment said the `x` had to exist because
   * `epics.spec.ts` went red when the row was deleted. **That was circular
   * and is corrected here.** The spec went red because its SELECTOR named a
   * node that no longer existed; the fix could equally have been one line
   * re-clicking the selected release. A broken locator is not a usability
   * finding.
   *
   * The real reasons, none of which that argument gave:
   *
   * - **Re-click-to-deselect is counter-conventional, not merely quiet.** In
   *   a native `select`, and in almost every combobox people use daily,
   *   clicking the chosen option confirms and closes. No learned model says
   *   it removes the value, so it is neither discovered by accident nor
   *   retained after being shown once.
   * - **"Reset filters" is not a fallback.** It is all or nothing. With
   *   status, area and release all set, dropping just the release is a
   *   different intent, and `AlephaTable`'s menu has no per-filter escape.
   * - **It costs nothing at rest**, since `showClear` needs a selection.
   *
   * ## No row comes back, at any size
   *
   * Feedback #2113 proposed a `None` row for `minimal`/`xs`, and the owner
   * dropped it the same day: this control had already been changed twice in
   * opposite directions, and keeping the row out leaves that sweep intact.
   * The `x` is the one answer everywhere it is drawn.
   *
   * ## `clearable`, not `deselectable`
   *
   * `deselectable` is `clearable || !meta.required`, so a large set of
   * optional fields accept re-click-to-clear and show no `x`: the component
   * holds both positions at once, that re-click suffices there and not here.
   *
   * That is a judgment call rather than a principle, and it is deliberate:
   * `clearable` is the caller saying empty is a meaningful state worth
   * ADVERTISING, so an ordinary optional field in a form keeps the trigger it
   * has today rather than growing a control for a state nobody is looking
   * for. Written down because it was previously undocumented, and an
   * undocumented asymmetry reads as an oversight to whoever finds it next.
   */
  const showClear =
    Boolean(props.clearable) && selected.length > 0 && !props.disabled;

  // The list (loading / empty / items) is identical for single and multi, and
  // so is the trigger now, so render it once.
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
          opt.selectAll ? (
            <ComboboxItem key="__select_all__" value={opt}>
              <ListChecks className="mr-2 size-4 shrink-0" />
              <span className="truncate font-medium">{opt.label}</span>
            </ComboboxItem>
          ) : opt.create ? (
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
                    <span className="bg-muted text-muted-foreground rounded px-1 text-[10px] tracking-wide uppercase">
                      {opt.tag}
                    </span>
                  )}
                  <span className="truncate">{opt.label}</span>
                </div>
                {opt.description && (
                  <span className="text-muted-foreground truncate text-xs">
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
      {/* One trigger for single AND multi. Multi used to render a bordered
          chips box instead, which made it a different-looking control for the
          same job, grew with every pick, and forced a search field on because
          the chips input was the only way to open the popup.

          Wrapped so the clear button below can sit ON the trigger without
          being INSIDE it: a button nested in a button is invalid, and Base
          UI renders this trigger as a real `<button>`. */}
      <div className="relative w-full">
        <ComboboxTrigger
          id={props.id}
          disabled={props.disabled}
          {...props.triggerProps}
          className={cn(
            "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex w-full items-center justify-between rounded-lg border bg-transparent whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
            sizeClasses.trigger,
            sizeClasses.chevron,
            props.minimal && MINIMAL_CLASSES,
            // Muted means "nothing chosen yet", and now that is simply
            // "nothing selected" for every shape.
            //
            // It used to carve out `clearable` singles, because for those empty
            // WAS a selected value - the injected clear row - and muting it made
            // one filter look unset while its neighbour looked set for the same
            // meaning. That row is gone (see `items`), so empty is empty and
            // reads as a placeholder everywhere.
            selected.length === 0 && "text-muted-foreground",
            props.triggerClassName,
          )}
        >
          {/* The room for the clear button, per size - see `clearGap` in
              SIZE_CLASSES for why it is a margin here and not padding on the
              trigger. */}
          <span
            className={cn(
              "flex min-w-0 items-center gap-2",
              showClear && sizeClasses.clearGap,
            )}
          >
            {props.icon && (
              <props.icon
                className={cn(
                  "text-muted-foreground shrink-0",
                  sizeClasses.icon,
                )}
              />
            )}
            <span className="truncate">{triggerLabel}</span>
          </span>
        </ComboboxTrigger>
        {showClear && (
          <button
            type="button"
            aria-label={String(
              tr("controlSelect.clear", { default: "Clear selection" }),
            )}
            className={cn(
              // ⚠️ Lighter than the chevron at rest, and it sharpens when
              // reached for. They are not peers: the chevron is decoration,
              // since the whole trigger opens the popup and nobody aims at
              // it, while this is the only element here with its own hit
              // target and its own action. Two equal grey glyphs side by
              // side make the eye separate them every time, and on a filter
              // rail with three filters set that is paid three times.
              //
              // Alpha on the TEXT COLOR, deliberately, and three things this
              // is not:
              //
              // - not a hover reveal. It must stay visible at rest: it is
              //   the only discoverable way to clear, there is no hover on
              //   touch, and an element appearing under the arriving pointer
              //   makes the control feel twitchy.
              // - not `opacity` on the button, which would fade the focus
              //   ring with it and weaken the keyboard state exactly when it
              //   needs to be strongest.
              // - not a background. `styles.css` defines a single muted
              //   tier, and alpha fades toward the trigger's own surface, so
              //   it lightens in light mode and darkens in dark with no
              //   per-theme override.
              "text-muted-foreground/60 hover:text-foreground focus-visible:text-foreground focus-visible:ring-ring/50 absolute top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors outline-none focus-visible:ring-2",
              sizeClasses.clear,
              props.minimal && MINIMAL_CLEAR_SHIFT,
            )}
            onClick={() => props.onChange(props.multi ? [] : undefined)}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <ComboboxContent>
        {props.searchable && (
          <ComboboxInput showTrigger={false} placeholder="Search…" />
        )}
        {popupBody}
      </ComboboxContent>
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

          // Coercion at a boundary: the value is a form/route/chart primitive whose
          // declared type is wider than what can reach here.
          // oxlint-disable-next-line typescript/no-base-to-string
          if (!isShort && defaultValue != null && String(defaultValue) !== "") {
            // Coercion at a boundary: the value is a form/route/chart primitive whose
            // declared type is wider than what can reach here.
            // oxlint-disable-next-line typescript/no-base-to-string
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
