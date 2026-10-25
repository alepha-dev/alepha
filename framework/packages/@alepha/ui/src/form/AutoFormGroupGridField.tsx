import * as React from "react";

void React;

import { type BaseInputField, useFieldValue } from "alepha/react/form";
import { resolveSchemaControl } from "alepha/react/ui";

import {
  Control,
  type ControlProps,
  readSchemaControl,
  useDynamicControlRefresh,
} from "./Control.tsx";
import { spanClass, widthFor } from "./grid.tsx";

export interface AutoFormGroupGridFieldProps {
  item: GroupItem;
  gridClassName?: string;
  disabled?: boolean;
}

/**
 * One field of the grid: the cell, sized, and the control inside it.
 *
 * ⚠️ Its own component rather than a `<div>` in `AutoFormGroupBlock`'s loop,
 * and that is the whole point of it. Sizing a cell means ASKING the field's
 * `$control` how wide it wants to be, and a function-form `$control` can only
 * be asked with `{ form, value }` and re-asked when another field changes -
 * two hooks, which cannot be called inside a `.map`.
 *
 * Before this, the grid was computed from the STATIC schema while `Control`
 * resolved the same `$control` DYNAMICALLY, and the two disagreed in both
 * directions: a field whose width came from a function silently fell back to
 * the 33% default (`widthFor` reads `.width` off the raw value, and a function
 * has none), and a field the function had hidden left its cell behind, holding
 * columns for a control that rendered nothing.
 */
export const AutoFormGroupGridField = (props: AutoFormGroupGridFieldProps) => {
  const { item } = props;
  const [value] = useFieldValue(item.input);
  useDynamicControlRefresh(item.input);

  const resolved = resolveSchemaControl(readSchemaControl(item.input), {
    form: item.input.form,
    value,
  });

  // `null` is the field saying it is not here AT ALL, so the cell goes with
  // it and the grid repacks.
  if (resolved === null) return null;

  // `resolved.width` first, matching the precedence `Control` applies when it
  // merges `{ ...props, ...resolved }`: what the schema asks for beats what a
  // `fields` entry passed in.
  const width = widthFor(
    item.input,
    (resolved.width ?? item.props.width) as number | undefined,
  );

  // `hidden` is the other answer: the field is here, it just draws nothing.
  // The cell stays, at its own width, so the fields around it do not move
  // while it comes and goes. That is the whole difference from `false`, and
  // it is why the width has to survive the resolve.
  const hidden = !!resolved.hidden;

  return (
    <div
      className={
        // Responsive grid: each field is one cell. Default: 12-col span from
        // width heuristics. A caller-supplied grid keeps its own column count
        // for scalars, but COMPLEX fields (an object card, a list of object
        // editors) still claim the whole row — squeezing one into a third of a
        // row is unreadable, and the heuristic already knows which those are
        // (width 100).
        props.gridClassName
          ? width >= 100
            ? "col-span-full"
            : undefined
          : spanClass(width)
      }
    >
      {hidden ? null : (
        <Control
          input={item.input}
          {...item.props}
          disabled={props.disabled || item.props.disabled}
        />
      )}
    </div>
  );
};

export interface GroupItem {
  name: string;
  input: BaseInputField;
  props: Partial<ControlProps>;
}
