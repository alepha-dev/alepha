import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";
import { CheckIcon } from "lucide-react";
import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./DropdownMenu.tsx";
import { cn } from "./utils.ts";

export type MenubarProps = MenubarPrimitive.Props;

const Menubar = (props: MenubarProps) => {
  const { className, ...rest } = props;
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn(
        "flex h-8 items-center gap-0.5 rounded-lg border p-[3px]",
        className,
      )}
      {...rest}
    />
  );
};

export type MenubarMenuProps = React.ComponentProps<typeof DropdownMenu>;

const MenubarMenu = (props: MenubarMenuProps) => {
  return <DropdownMenu data-slot="menubar-menu" {...props} />;
};

export type MenubarGroupProps = React.ComponentProps<typeof DropdownMenuGroup>;

const MenubarGroup = (props: MenubarGroupProps) => {
  return <DropdownMenuGroup data-slot="menubar-group" {...props} />;
};

export type MenubarPortalProps = React.ComponentProps<
  typeof DropdownMenuPortal
>;

const MenubarPortal = (props: MenubarPortalProps) => {
  return <DropdownMenuPortal data-slot="menubar-portal" {...props} />;
};

export type MenubarTriggerProps = React.ComponentProps<
  typeof DropdownMenuTrigger
>;

const MenubarTrigger = (props: MenubarTriggerProps) => {
  const { className, ...rest } = props;
  return (
    <DropdownMenuTrigger
      data-slot="menubar-trigger"
      className={cn(
        "hover:bg-hover aria-expanded:bg-muted flex items-center rounded-sm px-1.5 py-[2px] text-sm font-medium outline-hidden select-none",
        className,
      )}
      {...rest}
    />
  );
};

export type MenubarContentProps = React.ComponentProps<
  typeof DropdownMenuContent
>;

const MenubarContent = (props: MenubarContentProps) => {
  const {
    className,
    align = "start",
    alignOffset = -4,
    sideOffset = 8,
    ...rest
  } = props;
  return (
    <DropdownMenuContent
      data-slot="menubar-content"
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      className={cn(
        "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 min-w-36 rounded-lg p-1 shadow-md ring-1 duration-100",
        className,
      )}
      {...rest}
    />
  );
};

export type MenubarItemProps = React.ComponentProps<typeof DropdownMenuItem>;

const MenubarItem = (props: MenubarItemProps) => {
  const { className, inset, variant = "default", ...rest } = props;
  return (
    <DropdownMenuItem
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/menubar-item focus:bg-hover focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive! gap-1.5 rounded-md px-1.5 py-1 text-sm data-disabled:opacity-50 data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    />
  );
};

export type MenubarCheckboxItemProps = MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean;
};

const MenubarCheckboxItem = (props: MenubarCheckboxItemProps) => {
  const { className, children, checked, inset, ...rest } = props;
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      data-inset={inset}
      className={cn(
        "focus:bg-hover focus:text-accent-foreground focus:**:text-accent-foreground relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-7 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      checked={checked}
      {...rest}
    >
      <span className="pointer-events-none absolute left-1.5 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
};

export type MenubarRadioGroupProps = React.ComponentProps<
  typeof DropdownMenuRadioGroup
>;

const MenubarRadioGroup = (props: MenubarRadioGroupProps) => {
  return <DropdownMenuRadioGroup data-slot="menubar-radio-group" {...props} />;
};

export type MenubarRadioItemProps = MenuPrimitive.RadioItem.Props & {
  inset?: boolean;
};

const MenubarRadioItem = (props: MenubarRadioItemProps) => {
  const { className, children, inset, ...rest } = props;
  return (
    <MenuPrimitive.RadioItem
      data-slot="menubar-radio-item"
      data-inset={inset}
      className={cn(
        "focus:bg-hover focus:text-accent-foreground focus:**:text-accent-foreground relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-7 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      <span className="pointer-events-none absolute left-1.5 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
};

export type MenubarLabelProps = React.ComponentProps<
  typeof DropdownMenuLabel
> & {
  inset?: boolean;
};

const MenubarLabel = (props: MenubarLabelProps) => {
  const { className, inset, ...rest } = props;
  return (
    <DropdownMenuLabel
      data-slot="menubar-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-sm font-medium data-inset:pl-7",
        className,
      )}
      {...rest}
    />
  );
};

export type MenubarSeparatorProps = React.ComponentProps<
  typeof DropdownMenuSeparator
>;

const MenubarSeparator = (props: MenubarSeparatorProps) => {
  const { className, ...rest } = props;
  return (
    <DropdownMenuSeparator
      data-slot="menubar-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...rest}
    />
  );
};

export type MenubarShortcutProps = React.ComponentProps<
  typeof DropdownMenuShortcut
>;

const MenubarShortcut = (props: MenubarShortcutProps) => {
  const { className, ...rest } = props;
  return (
    <DropdownMenuShortcut
      data-slot="menubar-shortcut"
      className={cn(
        "text-muted-foreground group-focus/menubar-item:text-accent-foreground ml-auto text-xs tracking-widest",
        className,
      )}
      {...rest}
    />
  );
};

export type MenubarSubProps = React.ComponentProps<typeof DropdownMenuSub>;

const MenubarSub = (props: MenubarSubProps) => {
  return <DropdownMenuSub data-slot="menubar-sub" {...props} />;
};

export type MenubarSubTriggerProps = React.ComponentProps<
  typeof DropdownMenuSubTrigger
> & {
  inset?: boolean;
};

const MenubarSubTrigger = (props: MenubarSubTriggerProps) => {
  const { className, inset, ...rest } = props;
  return (
    <DropdownMenuSubTrigger
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-hover focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground gap-1.5 rounded-md px-1.5 py-1 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    />
  );
};

export type MenubarSubContentProps = React.ComponentProps<
  typeof DropdownMenuSubContent
>;

const MenubarSubContent = (props: MenubarSubContentProps) => {
  const { className, ...rest } = props;
  return (
    <DropdownMenuSubContent
      data-slot="menubar-sub-content"
      className={cn(
        "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 min-w-32 rounded-lg p-1 shadow-lg ring-1 duration-100",
        className,
      )}
      {...rest}
    />
  );
};

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
};
