import type { I18nProvider } from "alepha/react/i18n";
import type { ReactNode, RefObject } from "react";

import type { SelectOption } from "./ControlSelect.tsx";
import type { ControlSelectComboboxProps } from "./ControlSelectCombobox.tsx";

/**
 * Normalized option used as the Base UI `Combobox.Item` value. Because the
 * shape is `{ value, label }`, Base UI uses `label` for display/search and
 * `value` for selection automatically — which is what makes the popup search
 * match the visible label rather than the raw id.
 */
export interface ComboOption {
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
 * Internal sentinel for the "select every match" row. Same reasoning as
 * `CLEAR_VALUE`: it never reaches a caller, because it is expanded into the
 * matching values before `onChange` is called.
 */
const SELECT_ALL_VALUE = "__alepha_select_all__";

export const optValue = (o: SelectOption) =>
  typeof o === "string" ? o : o.value;
const optLabel = (o: SelectOption) => (typeof o === "string" ? o : o.label);
const optDesc = (o: SelectOption) =>
  typeof o === "string" ? undefined : o.description;
const optTag = (o: SelectOption) => (typeof o === "string" ? undefined : o.tag);
const optDisabled = (o: SelectOption) =>
  typeof o === "string" ? false : Boolean(o.disabled);
const optIcon = (o: SelectOption): ReactNode =>
  typeof o === "string" ? undefined : o.icon;

/**
 * The popup's rows, and the selection they are matched against, derived from
 * the field's `data`, its value and the typed query.
 *
 * Lifted out of `ControlSelectCombobox` as it stood, statement for statement,
 * so that file stays under 600 lines. No hook is called here: the component
 * still owns `query` and `labelCache`, and hands them in on every render.
 */
export const resolveComboboxItems = (
  props: ControlSelectComboboxProps,
  query: string,
  labelCache: RefObject<Map<string, string>>,
  tr: I18nProvider<any, any>["tr"],
) => {
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
        // oxlint-disable-next-line typescript/no-base-to-string -- a coercion at a boundary, see the comment above
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
  // `ControlSelectDeselect.browser.spec.tsx` already covers.
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
          label: tr("controlSelect.selectAll", {
            default: `Select ${unselectedMatches.length} matching "${query}"`,
            args: [String(unselectedMatches.length), query],
          }),
          selectAll: true,
        }
      : undefined;

  const items: ComboOption[] = [
    ...(selectAllRow ? [selectAllRow] : []),
    ...filtered,
    ...(createOption ? [createOption] : []),
  ];

  return { selected, labelFor, options, unselectedMatches, items };
};
