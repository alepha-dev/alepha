import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

import { cn } from "./utils.ts";

export type ContextMenuProps = ContextMenuPrimitive.Root.Props;

const ContextMenu = (props: ContextMenuProps) => {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
};

export type ContextMenuPortalProps = ContextMenuPrimitive.Portal.Props;

const ContextMenuPortal = (props: ContextMenuPortalProps) => {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  );
};

export type ContextMenuTriggerProps = ContextMenuPrimitive.Trigger.Props;

const ContextMenuTrigger = (props: ContextMenuTriggerProps) => {
  const { className, ...rest } = props;
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...rest}
    />
  );
};

export type ContextMenuContentProps = ContextMenuPrimitive.Popup.Props &
  Pick<
    ContextMenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >;

const ContextMenuContent = (props: ContextMenuContentProps) => {
  const {
    className,
    align = "start",
    alignOffset = 4,
    side = "right",
    sideOffset = 0,
    ...rest
  } = props;
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--available-height) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg p-1 shadow-md ring-1 duration-100 outline-none",
            className,
          )}
          {...rest}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
};

export type ContextMenuGroupProps = ContextMenuPrimitive.Group.Props;

const ContextMenuGroup = (props: ContextMenuGroupProps) => {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
};

export type ContextMenuLabelProps = ContextMenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
};

const ContextMenuLabel = (props: ContextMenuLabelProps) => {
  const { className, inset, ...rest } = props;
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "text-muted-foreground px-1.5 py-1 text-xs font-medium data-inset:pl-7",
        className,
      )}
      {...rest}
    />
  );
};

export type ContextMenuItemProps = ContextMenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
};

const ContextMenuItem = (props: ContextMenuItemProps) => {
  const { className, inset, variant = "default", ...rest } = props;
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item focus:bg-hover focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    />
  );
};

export type ContextMenuSubProps = ContextMenuPrimitive.SubmenuRoot.Props;

const ContextMenuSub = (props: ContextMenuSubProps) => {
  return (
    <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
  );
};

export type ContextMenuSubTriggerProps =
  ContextMenuPrimitive.SubmenuTrigger.Props & {
    inset?: boolean;
  };

const ContextMenuSubTrigger = (props: ContextMenuSubTriggerProps) => {
  const { className, inset, children, ...rest } = props;
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-hover focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
};

export type ContextMenuSubContentProps = React.ComponentProps<
  typeof ContextMenuContent
>;

const ContextMenuSubContent = (props: ContextMenuSubContentProps) => {
  return (
    <ContextMenuContent
      data-slot="context-menu-sub-content"
      className="shadow-lg"
      side="right"
      {...props}
    />
  );
};

export type ContextMenuCheckboxItemProps =
  ContextMenuPrimitive.CheckboxItem.Props & {
    inset?: boolean;
  };

const ContextMenuCheckboxItem = (props: ContextMenuCheckboxItemProps) => {
  const { className, children, checked, inset, ...rest } = props;
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "focus:bg-hover focus:text-accent-foreground relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...rest}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
};

export type ContextMenuRadioGroupProps = ContextMenuPrimitive.RadioGroup.Props;

const ContextMenuRadioGroup = (props: ContextMenuRadioGroupProps) => {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
};

export type ContextMenuRadioItemProps = ContextMenuPrimitive.RadioItem.Props & {
  inset?: boolean;
};

const ContextMenuRadioItem = (props: ContextMenuRadioItemProps) => {
  const { className, children, inset, ...rest } = props;
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        "focus:bg-hover focus:text-accent-foreground relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
};

export type ContextMenuSeparatorProps = ContextMenuPrimitive.Separator.Props;

const ContextMenuSeparator = (props: ContextMenuSeparatorProps) => {
  const { className, ...rest } = props;
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...rest}
    />
  );
};

export type ContextMenuShortcutProps = React.ComponentProps<"span">;

const ContextMenuShortcut = (props: ContextMenuShortcutProps) => {
  const { className, ...rest } = props;
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "text-muted-foreground group-focus/context-menu-item:text-accent-foreground ml-auto text-xs tracking-widest",
        className,
      )}
      {...rest}
    />
  );
};

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};
