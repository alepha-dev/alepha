import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { CheckIcon, SearchIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { InputGroup, InputGroupAddon } from "../core/InputGroup.tsx";
import { cn } from "../core/utils.ts";
import {
  type CommandFilter,
  type CommandItemGroup,
  defaultCommandFilter,
  defaultCommandItemToString,
  rankCommandItems,
} from "./rankCommandItems.ts";

export interface CommandProps<Item> extends Omit<
  AutocompletePrimitive.Root.Props<Item>,
  | "items"
  | "filteredItems"
  | "filter"
  | "mode"
  | "inline"
  | "open"
  | "defaultOpen"
  | "onOpenChange"
  | "autoHighlight"
  | "keepHighlight"
  | "itemToStringValue"
  | "children"
> {
  /**
   * Every row the palette can show, flat or in groups (`{ items, ...yours }`).
   * `CommandList` is handed back what the query leaves, in rank order.
   */
  items: readonly Item[] | readonly CommandItemGroup<Item>[];
  /**
   * The text an item is searched by. Defaults to a string item itself, or an
   * object's `label`.
   *
   * This replaces cmdk's per-item `value` and `keywords`: put everything a
   * row should be found by into the one string. Keep it short: the scorer
   * favours short strings, so a long description folded in ranks its row
   * below rows that match less of the query.
   */
  itemToStringValue?: (item: Item) => string;
  /**
   * Scores an item against the query: 0 hides it, higher lists it first.
   * Defaults to cmdk's fuzzy subsequence score over `itemToStringValue`.
   */
  filter?: CommandFilter<Item>;
  /**
   * `list` (the default) filters and ranks `items` as the query changes.
   * `none` shows `items` as given, for results that arrive already filtered
   * and ranked, from a server for instance.
   */
  mode?: "list" | "none";
  className?: string;
  children?: ReactNode;
}

/**
 * The palette itself: a search input over a list that stays on screen, on
 * Base UI's `Autocomplete` rendered `inline`.
 *
 * Data-driven, where cmdk was children-driven: the root takes `items`, and
 * `CommandList` / `CommandGroup` render what the query leaves through a
 * function child. The first row is always highlighted, as it was with cmdk,
 * so Enter runs the best match.
 */
export const Command = <Item,>(props: CommandProps<Item>) => {
  const {
    items,
    itemToStringValue,
    filter,
    mode = "list",
    className,
    children,
    value,
    defaultValue,
    onValueChange,
    ...rootProps
  } = props;

  const [uncontrolledQuery, setUncontrolledQuery] = useState(
    String(defaultValue ?? ""),
  );
  const query = value !== undefined ? String(value) : uncontrolledQuery;
  const toString =
    itemToStringValue ?? (defaultCommandItemToString as (item: Item) => string);
  const score: CommandFilter<Item> = filter ?? defaultCommandFilter;

  const filteredItems = useMemo(
    () =>
      mode === "none"
        ? undefined
        : rankCommandItems(items, query.trim(), score, toString),
    [mode, items, query, score, toString],
  );

  return (
    <AutocompletePrimitive.Root
      {...rootProps}
      inline
      open
      // One cast for both: Base UI types a flat and a grouped list as separate
      // overloads, and this root accepts either.
      items={items as readonly Item[]}
      filteredItems={filteredItems as readonly Item[] | undefined}
      mode={mode}
      autoHighlight="always"
      keepHighlight
      itemToStringValue={toString}
      value={query}
      onValueChange={(next, details) => {
        if (value === undefined) setUncontrolledQuery(next);
        onValueChange?.(next, details);
      }}
    >
      <div
        data-slot="command"
        className={cn(
          "bg-popover text-popover-foreground flex size-full flex-col overflow-hidden rounded-xl! p-1",
          className,
        )}
      >
        {children}
      </div>
    </AutocompletePrimitive.Root>
  );
};

export interface CommandDialogProps extends Omit<
  ComponentProps<typeof Dialog>,
  "children"
> {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  children: ReactNode;
}

export const CommandDialog = (props: CommandDialogProps) => {
  const {
    title = "Command Palette",
    description = "Search for a command to run...",
    children,
    className,
    showCloseButton = false,
    ...dialogProps
  } = props;
  return (
    <Dialog {...dialogProps}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className,
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};

export type CommandInputProps = AutocompletePrimitive.Input.Props;

export const CommandInput = (props: CommandInputProps) => {
  const { className, ...inputProps } = props;
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="border-input/30 bg-input/30 h-8! rounded-lg! shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <AutocompletePrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...inputProps}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
};

export interface CommandListProps<Item> extends Omit<
  AutocompletePrimitive.List.Props,
  "children"
> {
  /**
   * A function of each row (or each group) the query leaves, in rank order.
   */
  children: ReactNode | ((item: Item, index: number) => ReactNode);
}

export const CommandList = <Item,>(props: CommandListProps<Item>) => {
  const { className, ...listProps } = props;
  return (
    <AutocompletePrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className,
      )}
      {...listProps}
    />
  );
};

export type CommandEmptyProps = AutocompletePrimitive.Empty.Props;

/**
 * Shown when the query leaves nothing. A sibling of `CommandList`, not a child:
 * the list's child is the function that draws the rows. The element stays
 * mounted, empty, so screen readers announce it when it fills.
 */
export const CommandEmpty = (props: CommandEmptyProps) => {
  const { className, ...emptyProps } = props;
  return (
    <AutocompletePrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm empty:p-0", className)}
      {...emptyProps}
    />
  );
};

export interface CommandGroupProps<Item> extends Omit<
  AutocompletePrimitive.Group.Props,
  "children"
> {
  /**
   * The group's rows: the `items` of the group `CommandList` handed you.
   */
  items: readonly Item[];
  /**
   * Drawn above the rows, and the group's accessible label.
   */
  heading?: ReactNode;
  children: (item: Item, index: number) => ReactNode;
}

export const CommandGroup = <Item,>(props: CommandGroupProps<Item>) => {
  const { className, heading, items, children, ...groupProps } = props;
  return (
    <AutocompletePrimitive.Group
      data-slot="command-group"
      items={items as unknown[]}
      className={cn("text-foreground overflow-hidden p-1", className)}
      {...groupProps}
    >
      {heading !== undefined && heading !== null && heading !== "" ? (
        <AutocompletePrimitive.GroupLabel
          data-slot="command-group-heading"
          className="text-muted-foreground px-2 py-1.5 text-xs font-medium"
        >
          {heading}
        </AutocompletePrimitive.GroupLabel>
      ) : null}
      <AutocompletePrimitive.Collection>
        {(item: Item, index: number) => children(item, index)}
      </AutocompletePrimitive.Collection>
    </AutocompletePrimitive.Group>
  );
};

export type CommandSeparatorProps = AutocompletePrimitive.Separator.Props;

export const CommandSeparator = (props: CommandSeparatorProps) => {
  const { className, ...separatorProps } = props;
  return (
    <AutocompletePrimitive.Separator
      data-slot="command-separator"
      className={cn("bg-border -mx-1 h-px", className)}
      {...separatorProps}
    />
  );
};

export type CommandItemProps = AutocompletePrimitive.Item.Props;

/**
 * One row. `value` is the item from `items` it draws, and `onClick` runs on a
 * click and on Enter while the row is highlighted.
 */
export const CommandItem = (props: CommandItemProps) => {
  const { className, children, ...itemProps } = props;
  return (
    <AutocompletePrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:*:[svg]:text-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...itemProps}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </AutocompletePrimitive.Item>
  );
};

export type CommandShortcutProps = ComponentProps<"span">;

export const CommandShortcut = (props: CommandShortcutProps) => {
  const { className, ...spanProps } = props;
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "text-muted-foreground group-data-highlighted/command-item:text-foreground ml-auto text-xs tracking-widest",
        className,
      )}
      {...spanProps}
    />
  );
};
