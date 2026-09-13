import type { AlephaTableFilterAddType } from "@alepha/ui/components/alepha-table/alepha-table-filter-add";
import { AlephaTableFilterAdd } from "@alepha/ui/components/alepha-table/alepha-table-filter-add";
import { AlephaTableFilterControl } from "@alepha/ui/components/alepha-table/alepha-table-filter-control";
import { AlephaTableFilterOperator } from "@alepha/ui/components/alepha-table/alepha-table-filter-operator";
import { Control } from "@alepha/ui/components/control/control";
import { FilterSlot } from "@alepha/ui/components/filter-slot/filter-slot";
import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useFormValues } from "alepha/react/form";
import { AtSign, CircleDot, Search, Shield, Tag, Users } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";

export interface TableFilterBarProps {
  form: FormModel<ZObject>;
}

interface FilterDefinition {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  placeholder: string;
  /**
   * The control's shape, shown muted beside the filter in the add menu.
   */
  type: AlephaTableFilterAddType;
  /** Option labels. Absent for a free-text filter. */
  items?: Array<{ value: string; label: string }>;
  /**
   * How the value may be compared, the default FIRST. Stored in the form
   * field `<key>Op`, which the filters schema and the backend's query schema
   * both have to declare. Absent for a filter the backend only matches one
   * way, which then draws no switch at all.
   */
  operators?: Array<{
    value: string;
    label: string;
    /**
     * The word drawn before the value on the bar while this operator is in
     * force, so "not Active" never reads as "Active". The default has none.
     */
    prefix?: string;
  }>;
}

/**
 * The showcase's filter bar, and the reference for how the pieces fit: a
 * `FilterSlot` per filter, an `AlephaTableFilterControl` wrapping each
 * `Control`, and an `AlephaTableFilterAdd` at the end.
 *
 * A component rather than an inline `render` callback because it holds state
 * - which filters are on screen - and a callback cannot hold a hook.
 *
 * **The bar starts with the search box alone.** Every other filter is added by
 * the reader. Showing all five up front spends the width of the bar saying
 * that those columns exist, which is not a question anyone asked.
 *
 * ⚠️ "Alone" means alone among EMPTY filters. A filter holding a value is
 * always on the bar, however it got that value. Which filters are shown is
 * this component's state, and it starts empty on every mount; the values are
 * the table's, and they outlive it - restored from persistence on a reload,
 * from the URL on a shared link, and carried across every remount the page's
 * knobs cause. Keyed on `shown` alone, the bar came back empty while the
 * table stayed filtered, and "Add filter" handed back a filter that was
 * already set.
 *
 * It carries one of each control shape on purpose, because they are what a
 * filter bar has to survive: a free-text box, a single select, a MULTI select
 * (`roles`, whose array schema is what makes `Control` render it that way),
 * and a text-contains on one column (`email`, narrower than `search`, which
 * spans name and email together).
 *
 * ⚠️ Every option LABEL is capitalized; no stored value is. `status` holds
 * `active` in the dataset and in the query, and only the label reads "Active".
 * Capitalizing the value instead would leave the filter matching no row at all
 * - the failure would be an empty table, not a cosmetic one.
 */
export const TableFilterBar = (props: TableFilterBarProps) => {
  const values = useFormValues(props.form) as Record<string, unknown>;
  const [shown, setShown] = useState<string[]>([]);
  // The filter to open once React has put it on screen. A REF, not state: the
  // effect below both reads and clears it, and clearing it with `setState`
  // inside an effect is a cascading render (and a lint error). Nothing renders
  // from this value, so state would buy nothing anyway.
  const pendingOpen = useRef<string | undefined>(undefined);

  const inputs = props.form.input as unknown as Record<
    string,
    { set: (value: unknown) => void }
  >;

  const definitions: FilterDefinition[] = [
    {
      key: "status",
      type: "list",
      operators: [
        { value: "is", label: "is" },
        { value: "not", label: "is not", prefix: "not" },
      ],
      label: "Status",
      icon: CircleDot,
      placeholder: "Any status",
      items: [
        { value: "active", label: "Active" },
        { value: "invited", label: "Invited" },
        { value: "disabled", label: "Disabled" },
      ],
    },
    {
      key: "team",
      type: "list",
      label: "Team",
      icon: Users,
      placeholder: "Any team",
      items: [
        { value: "Platform", label: "Platform" },
        { value: "Design", label: "Design" },
        { value: "Growth", label: "Growth" },
        { value: "Security", label: "Security" },
      ],
    },
    {
      key: "roles",
      type: "list",
      // No "all of": a member has one role, so it could only ever match
      // nobody. See `tags` for the column where it means something.
      operators: [
        { value: "any", label: "any of" },
        { value: "none", label: "none of", prefix: "not" },
      ],
      label: "Roles",
      icon: Shield,
      placeholder: "Any role",
      items: [
        { value: "Owner", label: "Owner" },
        { value: "Admin", label: "Admin" },
        { value: "Member", label: "Member" },
        { value: "Viewer", label: "Viewer" },
      ],
    },
    {
      key: "tags",
      type: "list",
      label: "Tags",
      icon: Tag,
      placeholder: "Any tag",
      items: [
        { value: "remote", label: "Remote" },
        { value: "on-call", label: "On-call" },
        { value: "mentor", label: "Mentor" },
        { value: "contractor", label: "Contractor" },
        { value: "beta", label: "Beta" },
      ],
      operators: [
        { value: "any", label: "any of" },
        { value: "all", label: "all of", prefix: "all" },
        { value: "none", label: "none of", prefix: "not" },
      ],
    },
    {
      key: "email",
      type: "text",
      label: "Email",
      icon: AtSign,
      placeholder: "Email contains…",
    },
  ];

  useEffect(() => {
    const key = pendingOpen.current;
    if (!key) return;
    pendingOpen.current = undefined;
    // ⚠️ Opening the new filter has to happen from OUT HERE, after the render
    // that mounts it. Inside the menu's own click handler the control does not
    // exist yet, so there is nothing to open.
    //
    // It is driven through the DOM because `Control` exposes no imperative
    // "open" - a combobox owns that state internally. A ref would give us the
    // element and still not give us the method.
    //
    // A text filter has no dropdown to open, so it is focused instead: the
    // reader asked for it, and landing with the caret in it is the equivalent
    // of landing with the list down.
    const slot = document.querySelector(`[data-filter="${key}"]`);
    const trigger = slot?.querySelector<HTMLElement>(
      '[data-slot="combobox-trigger"]',
    );
    if (trigger) {
      trigger.click();
      return;
    }
    slot?.querySelector<HTMLInputElement>('[data-slot="input"]')?.focus();
  }, [shown]);

  // A filter goes back to its default operator whenever its value goes: an
  // operator left standing with nothing to qualify still counts as a filter
  // in the table's reset button and badge, while narrowing nothing.
  const clearFilter = (definition: FilterDefinition) => {
    inputs[definition.key]?.set(undefined);
    if (definition.operators) inputs[`${definition.key}Op`]?.set(undefined);
  };

  const operatorOf = (definition: FilterDefinition) =>
    definition.operators?.find(
      (operator) => operator.value === values[`${definition.key}Op`],
    ) ?? definition.operators?.[0];

  const isActive = (key: string): boolean => {
    const value = values[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };

  // A filter holding a value, or an operator, joins `shown` the moment it is
  // seen - see the docblock. An operator counts too: on its own it narrows
  // nothing, but the table still counts it as a filter, and nothing counted
  // may be invisible.
  //
  // Folded INTO `shown` rather than drawn as `shown ∪ set`, because a filter
  // visible only for holding a value would unmount the instant the reader
  // emptied it, popup open and cursor on it. Once in, it stays until removed.
  //
  // Set during render, which React supports for state derived from props: it
  // re-renders this component before committing, with no flash of the bar
  // without the filter. The guard is what stops it looping - it only fires
  // while something is missing, and the update adds exactly that.
  const unshown = definitions
    .filter(
      (definition) =>
        (isActive(definition.key) ||
          values[`${definition.key}Op`] !== undefined) &&
        !shown.includes(definition.key),
    )
    .map((definition) => definition.key);
  if (unshown.length > 0) {
    setShown([...shown, ...unshown]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        Search is not removable and so is not in `definitions`: it is the one
        filter always on screen. It is given neither `onClear` nor `onRemove`,
        so the container draws no button and the input keeps its own classic
        cross, inside the field.
      */}
      <FilterSlot>
        <AlephaTableFilterControl label="Search">
          <Control
            input={props.form.input.search}
            label=""
            icon={Search}
            placeholder="Search"
          />
        </AlephaTableFilterControl>
      </FilterSlot>

      {definitions
        .filter((definition) => shown.includes(definition.key))
        .map((definition) => (
          <FilterSlot key={definition.key}>
            <div data-filter={definition.key}>
              <AlephaTableFilterControl
                label={definition.label}
                active={isActive(definition.key)}
                // The cross empties a filter that holds a value, and removes
                // one that does not - so a reader who only wanted "any team
                // again" never loses the filter, and a second click on the
                // now-empty box takes it out. `active` is what picks between
                // the two, which is why it is not optional here.
                onClear={() => clearFilter(definition)}
                onRemove={() => {
                  // Still clears on the way out: reaching here with a value
                  // is possible (a filter removed from the menu, say), and a
                  // removed filter that is still narrowing the list leaves
                  // the reader with a short list and no reason on screen.
                  clearFilter(definition);
                  setShown((keys) =>
                    keys.filter((key) => key !== definition.key),
                  );
                }}
              >
                <Control
                  input={inputs[definition.key] as never}
                  label=""
                  icon={definition.icon}
                  clearable
                  placeholder={definition.placeholder}
                  items={definition.items as never}
                  // TRIAL (2026-09-13): the filter's name in front of its
                  // value, muted with the operator, so a set filter reads as
                  // a sentence - "Status not Active", "Team Design". The
                  // placeholder already names the filter while it is empty
                  // ("Any status"), and the select draws no prefix then.
                  triggerPrefix={[
                    definition.label,
                    operatorOf(definition)?.prefix,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  // Sized from its own content, not from the trigger: the
                  // trigger grows as the reader picks ("Status not Active"),
                  // and a popup tied to it would widen under the cursor.
                  // The floor keeps a short list from opening as a sliver.
                  popupClassName="w-max min-w-48"
                  popupHeader={
                    definition.operators && (
                      <AlephaTableFilterOperator
                        options={definition.operators}
                        value={operatorOf(definition)?.value}
                        onChange={(value) =>
                          inputs[`${definition.key}Op`]?.set(value)
                        }
                      />
                    )
                  }
                />
              </AlephaTableFilterControl>
            </div>
          </FilterSlot>
        ))}

      <AlephaTableFilterAdd
        items={definitions.filter(
          (definition) => !shown.includes(definition.key),
        )}
        onAdd={(key) => {
          pendingOpen.current = key;
          setShown((keys) => [...keys, key]);
        }}
      />
    </div>
  );
};
