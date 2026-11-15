import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
} from "react";

import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";

export interface FolioTableCellEditorProps {
  column: FolioColumnResource;
  /**
   * The text the editor opens on: the cell's value, or the character typed
   * on a focused cell, which starts the edit with it.
   */
  initial: string;
  /**
   * Write the value. `move` says where the focus goes after: down on Enter,
   * right on Tab, nowhere on blur.
   */
  onCommit: (value: string, move: "down" | "right" | "none") => void;
  onCancel: () => void;
  /**
   * What a reference cell offers: the same entries the Markdown editor's
   * `[[#` picker lists (folios, quests, epics), each by its code.
   */
  referenceSuggestions?: Array<{ token: string; label: string }>;
  /**
   * Take the focus on mount. True in the grid, false in a form of several
   * cells (the calendar's row sheet).
   */
  autoFocus?: boolean;
  /**
   * Stay open after a commit, so the same field writes again on the next
   * change: the row sheet's fields. The grid's editor closes on commit.
   */
  persistent?: boolean;
}

/**
 * One cell in edit mode (#Q3516), by its column's type: a text input, a
 * number input, a date (with time when the column has it), a select of the
 * column's options, or a reference picked from the `[[#` picker's entries
 * (or typed as its code, `#Q12`, for one the picker's page does not hold).
 *
 * Always a `Control` over a one-field `useForm`, never a raw input: the
 * kit's fields carry its focus rings, its RTL rules and its date picker.
 * Enter commits and moves down, Tab commits and moves right, Escape
 * cancels, leaving the cell commits. A checkbox has no editor: the grid
 * toggles it in place.
 */
const FolioTableCellEditor = (
  props: FolioTableCellEditorProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const latest = useRef(props.initial);
  const done = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  // `autoFocus` reaches a text input only. A select's, a date's or a
  // reference's trigger is a button the kit renders, so the editor focuses
  // its first control itself, or the keyboard stays on the grid and the
  // control cannot be opened without a mouse.
  useEffect(() => {
    const element = root.current;
    if (props.autoFocus === false) return;
    if (!element || element.contains(document.activeElement)) return;
    element
      .querySelector<HTMLElement>(
        "input:not([type=hidden]), button, [tabindex]:not([tabindex='-1'])",
      )
      ?.focus();
    // On mount only: a later render must not pull the focus back.
  }, []);

  const form = useForm({
    schema: z.object({ value: z.string() }),
    initialValues: { value: props.initial },
    handler: async () => {},
    onChange: (_key, next) => {
      latest.current = next === undefined || next === null ? "" : String(next);
      // A pick from a list is the whole edit: write it at once.
      if (
        props.column.type === "select" ||
        props.column.type === "date" ||
        props.column.type === "reference"
      ) {
        finish(latest.current, "none");
      }
    },
  });

  const finish = (value: string, move: "down" | "right" | "none") => {
    if (done.current) return;
    if (!props.persistent) done.current = true;
    props.onCommit(value, move);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key pressed in a popup (a select's list, the date picker) reaches
    // here through React's portal bubbling, before the pick it makes has
    // landed: it belongs to the popup, never to the edit.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!props.persistent) done.current = true;
      props.onCancel();
    } else if (event.key === "Enter" && !event.shiftKey) {
      // In a select, a date or a reference, Enter opens the list or picks
      // from it, and the pick commits through the form's change: committing
      // here as well would write the value from before the pick.
      if (
        props.column.type === "select" ||
        props.column.type === "date" ||
        props.column.type === "reference"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(latest.current, "down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      finish(latest.current, "right");
    }
  };

  const label = props.column.name;
  const common = {
    input: form.input.value,
    label: "",
    autoFocus: props.autoFocus ?? true,
    inputProps: { "aria-label": label, "data-testid": "folio-cell-editor" },
  };

  return (
    // The editor's own keys must not reach the grid's navigation.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={root}
      className="w-full"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        // A popover (the date picker, the select's and the reference's
        // lists) takes the focus outside this element while it is open:
        // only text fields commit on blur.
        if (props.column.type === "text" || props.column.type === "number") {
          finish(latest.current, "none");
        }
      }}
    >
      {props.column.type === "select" ? (
        <Control
          {...common}
          select
          items={[
            { value: "", label: tr("folios.table.cell.none") },
            ...(props.column.options.choices ?? []).map((choice) => ({
              value: choice.label,
              label: choice.label,
            })),
          ]}
        />
      ) : props.column.type === "reference" ? (
        <Control
          {...common}
          combobox
          createNewEntry
          placeholder={tr("folios.table.cell.reference-placeholder")}
          items={[
            { value: "", label: tr("folios.table.cell.none") },
            ...(props.initial &&
            !(props.referenceSuggestions ?? []).some(
              (entry) => entry.token === props.initial,
            )
              ? [{ value: props.initial, label: props.initial }]
              : []),
            ...(props.referenceSuggestions ?? []).map((entry) => ({
              value: entry.token,
              label: `${entry.token} ${entry.label}`,
            })),
          ]}
        />
      ) : props.column.type === "date" ? (
        <Control
          {...common}
          {...(props.column.options.withTime
            ? { datetime: true }
            : { date: true })}
          clearable
        />
      ) : (
        <Control
          {...common}
          inputProps={{
            ...common.inputProps,
            ...(props.column.type === "number"
              ? { inputMode: "decimal" as never }
              : {}),
          }}
        />
      )}
    </div>
  );
};

export default FolioTableCellEditor;
