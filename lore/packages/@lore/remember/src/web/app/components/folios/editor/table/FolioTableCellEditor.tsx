import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { type KeyboardEvent, type ReactElement, useRef } from "react";

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
    done.current = true;
    props.onCommit(value, move);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      done.current = true;
      props.onCancel();
    } else if (event.key === "Enter" && !event.shiftKey) {
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
    autoFocus: true,
    inputProps: { "aria-label": label, "data-testid": "folio-cell-editor" },
  };

  return (
    // The editor's own keys must not reach the grid's navigation.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
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
