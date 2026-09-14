import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

import { cn } from "./utils.ts";

export type DropdownMenuProps = MenuPrimitive.Root.Props;

const DropdownMenu = (props: DropdownMenuProps) => {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
};

export type DropdownMenuPortalProps = MenuPrimitive.Portal.Props;

const DropdownMenuPortal = (props: DropdownMenuPortalProps) => {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
};

export type DropdownMenuTriggerProps = MenuPrimitive.Trigger.Props;

const DropdownMenuTrigger = (props: DropdownMenuTriggerProps) => {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
};

export type DropdownMenuContentProps = MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >;

const DropdownMenuContent = (props: DropdownMenuContentProps) => {
  const {
    align = "start",
    alignOffset = 0,
    side = "bottom",
    sideOffset = 4,
    className,
    ...rest
  } = props;
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            // `w-auto`, not `w-(--anchor-width)`: a menu is not a select, and
            // sizing it to a 32px icon trigger wrapped every label past
            // `min-w-32`. `max-w-(--available-width)` keeps `w-auto` from
            // running off the viewport.
            "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--available-height) w-auto max-w-(--available-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg p-1 shadow-md ring-1 duration-100 outline-none data-closed:overflow-hidden",
            className,
          )}
          {...rest}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
};

export type DropdownMenuGroupProps = MenuPrimitive.Group.Props;

const DropdownMenuGroup = (props: DropdownMenuGroupProps) => {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
};

export type DropdownMenuLabelProps = MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
};

const DropdownMenuLabel = (props: DropdownMenuLabelProps) => {
  const { className, inset, ...rest } = props;
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "text-muted-foreground px-1.5 py-1 text-xs font-medium data-inset:pl-7",
        className,
      )}
      {...rest}
    />
  );
};

export type DropdownMenuItemProps = MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
};

const DropdownMenuItem = (props: DropdownMenuItemProps) => {
  const { className, inset, variant = "default", ...rest } = props;
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    />
  );
};

export type DropdownMenuSubProps = MenuPrimitive.SubmenuRoot.Props;

const DropdownMenuSub = (props: DropdownMenuSubProps) => {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
};

export type DropdownMenuSubTriggerProps = MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
};

const DropdownMenuSubTrigger = (props: DropdownMenuSubTriggerProps) => {
  const { className, inset, children, ...rest } = props;
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  );
};

export type DropdownMenuSubContentProps = React.ComponentProps<
  typeof DropdownMenuContent
>;

const DropdownMenuSubContent = (props: DropdownMenuSubContentProps) => {
  const {
    align = "start",
    alignOffset = -3,
    side = "right",
    sideOffset = 0,
    className,
    ...rest
  } = props;
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 w-auto min-w-[96px] rounded-lg p-1 shadow-lg ring-1 duration-100",
        className,
      )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...rest}
    />
  );
};

export type DropdownMenuCheckboxItemProps = MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean;
};

const DropdownMenuCheckboxItem = (props: DropdownMenuCheckboxItemProps) => {
  const { className, children, checked, inset, ...rest } = props;
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...rest}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
};

export type DropdownMenuRadioGroupProps = MenuPrimitive.RadioGroup.Props;

const DropdownMenuRadioGroup = (props: DropdownMenuRadioGroupProps) => {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
};

export type DropdownMenuRadioItemProps = MenuPrimitive.RadioItem.Props & {
  inset?: boolean;
};

const DropdownMenuRadioItem = (props: DropdownMenuRadioItemProps) => {
  const { className, children, inset, ...rest } = props;
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
};

export type DropdownMenuSeparatorProps = MenuPrimitive.Separator.Props;

const DropdownMenuSeparator = (props: DropdownMenuSeparatorProps) => {
  const { className, ...rest } = props;
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...rest}
    />
  );
};

export type DropdownMenuShortcutProps = React.ComponentProps<"span">;

const DropdownMenuShortcut = (props: DropdownMenuShortcutProps) => {
  const { className, ...rest } = props;
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground ml-auto text-xs tracking-widest",
        className,
      )}
      {...rest}
    />
  );
};

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
