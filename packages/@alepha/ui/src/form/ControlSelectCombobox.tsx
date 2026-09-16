import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { ListChecks, Loader2 } from "lucide-react";
import type { HTMLAttributes } from "react";
import { type ReactNode, useRef, useState } from "react";

import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Combobox as ComboboxRoot,
  ComboboxTrigger,
} from "../core/Combobox.tsx";
import { cn } from "../core/utils.ts";
import type {
  ControlSelectProps,
  ControlSelectSize,
  SelectOption,
} from "./ControlSelect.tsx";
import {
  type ComboOption,
  resolveComboboxItems,
} from "./controlSelectOptions.ts";
import {
  ControlClearButton,
  TRIGGER_CLASSES,
  TRIGGER_MINIMAL_CLASSES,
  TRIGGER_SIZES,
  TRIGGER_WRAPPER_CLASSES,
} from "./fieldTrigger.tsx";
import type { IconComponent } from "./iconHint.tsx";

export interface ControlSelectComboboxProps {
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
   * See `ControlSelectProps.countLabel` in `ControlSelect.tsx`.
   */
  countLabel?: (count: number) => string;
  /**
   * See `ControlSelectProps.maxTriggerLength` in `ControlSelect.tsx`.
   */
  maxTriggerLength?: number;
  /**
   * Allow the single-select value to be unset by pressing the row that is
   * already selected. Set for optional (and `clearable`) fields only.
   */
  deselectable?: boolean;
  /**
   * See `ControlSelectProps.popupHeader` in `ControlSelect.tsx`.
   */
  popupHeader?: ReactNode;
  /**
   * See `ControlSelectProps.triggerPrefix` in `ControlSelect.tsx`.
   */
  triggerPrefix?: ReactNode;
  /**
   * See `ControlSelectProps.popupClassName` in `ControlSelect.tsx`.
   */
  popupClassName?: string;
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
export const ControlSelectCombobox = (props: ControlSelectComboboxProps) => {
  const { tr } = useI18n();
  const sizeClasses = TRIGGER_SIZES[props.size ?? "default"];
  const [query, setQuery] = useState("");
  // Remembers labels for values the user has picked, so the trigger/chips keep
  // a human label even after the source option drops out of a server-filtered
  // `data` set — or for freshly created entries that never existed in `data`.
  const labelCache = useRef(new Map<string, string>());

  const { selected, labelFor, options, unselectedMatches, items } =
    resolveComboboxItems(props, query, labelCache, tr);

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
   * The selection's names, in the list's order, joined.
   *
   * The list's order and not the picking order, so the same selection always
   * reads the same, and a pick never reshuffles the names already shown.
   * Every selected value has a row in `options` (an orphan is injected for
   * one `data` lacks), so the index is always found.
   */
  const names = selected
    .map((value) => ({
      value,
      at: options.findIndex((o) => o.value === value),
    }))
    .sort((a, b) => a.at - b.at)
    .map((entry) => labelFor(entry.value))
    .join(", ");

  /**
   * Names while they are short, then a count.
   *
   * One selection names itself however long it is: "1 value" is never better.
   * Two or more are named while the joined text fits `maxTriggerLength`
   * characters (20 by default), and collapse to a count past it.
   *
   * A budget of characters rather than of items: "Draft, Ready" says what a
   * filter holds where "2 values" makes the reader open it, while
   * "lore/quests, alepha/orm" would only truncate into a list that looks
   * shorter than it is. The chips box this replaced did exactly that, growing
   * with every pick and then truncating. The budget caps the trigger's width
   * instead, and needs no measuring, so the server renders the same text.
   *
   * ⚠️ Characters are not pixels, so the cap is approximate, and a pick that
   * crosses it shrinks the trigger from names to a count.
   */
  const maxTriggerLength = props.maxTriggerLength ?? 20;
  const triggerLabel = props.multi
    ? selected.length === 0
      ? emptyLabel
      : selected.length === 1 || names.length <= maxTriggerLength
        ? names
        : (props.countLabel?.(selected.length) ??
          tr("controlSelect.count", {
            default: `${selected.length} values`,
            args: [String(selected.length)],
          }))
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
   *   different intent, and `DataTable`'s menu has no per-filter escape.
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
      <div className={TRIGGER_WRAPPER_CLASSES}>
        <ComboboxTrigger
          id={props.id}
          disabled={props.disabled}
          {...props.triggerProps}
          className={cn(
            TRIGGER_CLASSES,
            sizeClasses.trigger,
            sizeClasses.chevron,
            props.minimal && TRIGGER_MINIMAL_CLASSES,
            // Muted means "nothing chosen yet", and now that is simply
            // "nothing selected" for every shape.
            //
            // It used to carve out `clearable` singles, because for those empty
            // WAS a selected value - the injected clear row - and muting it made
            // one filter look unset while its neighbour looked set for the same
            // meaning. That row is gone (see `items` in
            // `controlSelectOptions.ts`), so empty is empty and reads as a
            // placeholder everywhere.
            selected.length === 0 && "text-muted-foreground",
            props.triggerClassName,
          )}
        >
          {/* The room for the clear button, per size - see `clearGap` in
              TRIGGER_SIZES for why it is a margin here and not padding on the
              trigger. `trigger-label` lets a container that hides the button
              (`DataTableFilterControl`) take the room back. */}
          <span
            data-slot="trigger-label"
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
            {/*
              The prefix rides in the SAME text run as the label, separated by
              an ordinary space. As a flex sibling it was spaced by the row's
              `gap-2`, 8px, while the words inside it were a font space apart,
              so "Status not Active" read "Status not  Active". One run makes
              every gap the same space, and truncation eats from the end of
              the value rather than squeezing the two apart.
            */}
            <span className="truncate">
              {props.triggerPrefix && selected.length > 0 && (
                <span className="text-muted-foreground">
                  {props.triggerPrefix}{" "}
                </span>
              )}
              {triggerLabel}
            </span>
          </span>
        </ComboboxTrigger>
        {showClear && (
          <ControlClearButton
            size={props.size}
            onClick={() => props.onChange(props.multi ? [] : undefined)}
          />
        )}
      </div>
      <ComboboxContent className={props.popupClassName}>
        {props.popupHeader}
        {props.searchable && (
          <ComboboxInput showTrigger={false} placeholder="Search…" />
        )}
        {popupBody}
      </ComboboxContent>
    </ComboboxRoot>
  );
};
