import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

import { cn } from "../core/utils.ts";
import { SettingsHeading } from "../settings/SettingsHeading.tsx";
import type { AutoFormGroup } from "./AutoForm.tsx";
import {
  AutoFormGroupGridField,
  type GroupItem,
} from "./AutoFormGroupGridField.tsx";
import { Control, type ControlProps } from "./Control.tsx";
import { iconFor } from "./iconHint.tsx";

export interface AutoFormGroupBlockProps {
  group: AutoFormGroup;
  inputs: Record<string, never>;
  fields?: Partial<Record<string, Partial<Omit<ControlProps, "input">>>>;
  i18nPrefix?: string;
  disabled?: boolean;
  multiGroup?: boolean;
  layout: "stack" | "row";
  gridClassName?: string;
  /**
   * The form's action bar, rendered as this group's last divided row. Set by
   * `AutoForm` on the *last* group in `layout="row"`; `undefined` everywhere
   * else, including every group in the grid layout.
   */
  bottomBar?: ReactNode;
}

export const AutoFormGroupBlock = (props: AutoFormGroupBlockProps) => {
  const { group } = props;
  const { tr } = useI18n();
  const Icon = group.icon ? iconFor(group.icon) : undefined;

  const items = group.fields
    .map((entry) => {
      const name = typeof entry === "string" ? entry : entry.name;
      const override =
        typeof entry === "object" ? (entry as Partial<ControlProps>) : {};
      const input = props.inputs[name];
      if (!input) return null;
      const fromMap = props.fields?.[name] ?? {};
      const merged: Partial<ControlProps> = {
        ...fromMap,
        ...override,
      };
      // i18nPrefix: fill label/description from the dictionary when neither
      // the override nor the schema already provides one. A missing key
      // makes `tr` echo the key back (an empty `default` is falsy, so the
      // provider can't substitute it) — guard with `!== key` so an absent
      // entry leaves the Control to fall back to `schema.title ??
      // prettyName(field)`, preserving current behaviour.
      if (props.i18nPrefix && merged.label === undefined) {
        const key = `${props.i18nPrefix}.${name}`;
        const label = tr(key, { default: "" });
        if (label && label !== key) merged.label = label;
      }
      if (props.i18nPrefix && merged.description === undefined) {
        const key = `${props.i18nPrefix}.${name}.desc`;
        const desc = tr(key, { default: "" });
        if (desc && desc !== key) merged.description = desc;
      }
      // Hand the extended prefix down so an object's children and an array's
      // item fields resolve their own labels/help
      // (`parameters.x.payg.dailyCapCents.desc`).
      if (props.i18nPrefix && merged.i18nPrefix === undefined) {
        merged.i18nPrefix = `${props.i18nPrefix}.${name}`;
      }
      return { name, input, props: merged };
    })
    .filter(Boolean) as GroupItem[];

  // `!props.bottomBar`: a group carrying the action bar still renders when it
  // has no resolvable fields, or the form would silently lose its submit
  // button rather than merely render empty.
  if (!items.length && !props.multiGroup && !props.bottomBar) return null;

  // Naked group: no title, no icon → no card chrome (lets solo complex
  // fields render with just their own header).
  const isNaked = !group.title && !Icon;

  // Row layout: each group becomes a divider-stacked card, every Control
  // takes a full row through its own FormField row layout (via context).
  if (props.layout === "row") {
    const hasHeading = !!(group.title || group.description);
    return (
      <div className="shrink-0">
        {hasHeading && (
          // `SettingsHeading` rather than a local span pair: this is the same
          // heading `SettingsSection` renders, and the whole reason that
          // component exists is that there be exactly one of it. `items-start`
          // + `mt-0.5` keeps the icon on the title line when a description
          // wraps a second one under it.
          <div className="mb-2 flex items-start gap-2">
            {Icon && (
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            )}
            <SettingsHeading
              title={group.title}
              description={group.description}
            />
          </div>
        )}
        <div className="bg-card divide-y rounded-lg border shadow-sm">
          {items.map((it) => (
            <Control
              key={it.name}
              input={it.input}
              {...it.props}
              disabled={props.disabled || it.props.disabled}
            />
          ))}
          {props.bottomBar && (
            // Same `px-4 py-3` every row carries, so the action row sits on
            // the card's own rhythm and `divide-y` draws its rule flush.
            <div className="px-4 py-3">{props.bottomBar}</div>
          )}
        </div>
      </div>
    );
  }

  // `shrink-0` on every group root, titled or naked. Under `fill` the groups
  // are flex items of a `CardContent` that has a definite height, and per the
  // flexbox automatic-minimum-size rule an item whose computed `overflow` is
  // not `visible` gets an auto min size of 0. The titled group is the only one
  // carrying `overflow-hidden`, so it was the only child that could give way:
  // once the expanded object groups overflowed the card it absorbed all of it
  // and collapsed to nothing. `CardContent` already asked for `overflow-y-auto`
  // and now gets to do the scrolling itself.
  const wrapperCls = cn(
    "shrink-0",
    props.multiGroup && !isNaked && "overflow-hidden rounded-md border",
  );

  return (
    <div className={wrapperCls}>
      {props.multiGroup && !isNaked && (
        <div className="bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
          {Icon && <Icon className="text-muted-foreground size-4" />}
          {group.title && (
            <span className="text-sm font-medium">{group.title}</span>
          )}
        </div>
      )}
      <div
        className={cn(
          "grid gap-3",
          props.gridClassName ?? "grid-cols-12",
          !isNaked && "p-3",
        )}
      >
        {items.map((it) => (
          <AutoFormGroupGridField
            key={it.name}
            item={it}
            gridClassName={props.gridClassName}
            disabled={props.disabled}
          />
        ))}
      </div>
    </div>
  );
};
