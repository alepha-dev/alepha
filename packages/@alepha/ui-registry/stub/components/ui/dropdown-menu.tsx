import type { ReactNode } from "react";

export const DropdownMenu: (props: { children?: ReactNode }) => any = () =>
  null;
export const DropdownMenuTrigger: (props: {
  asChild?: boolean;
  children?: ReactNode;
}) => any = () => null;
export const DropdownMenuContent: (props: {
  align?: "start" | "center" | "end";
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DropdownMenuItem: (props: {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DropdownMenuLabel: (props: { children?: ReactNode }) => any = () =>
  null;
export const DropdownMenuSeparator: (props: Record<string, never>) => any =
  () => null;
export const DropdownMenuGroup: (props: { children?: ReactNode }) => any = () =>
  null;
export const DropdownMenuShortcut: (props: { children?: ReactNode }) => any =
  () => null;
export const DropdownMenuCheckboxItem: (props: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /**
   * Radix passes a selection event here. Consumers commonly call
   * `e.preventDefault()` to keep the dropdown open after toggling.
   */
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DropdownMenuRadioGroup: (props: {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}) => any = () => null;
export const DropdownMenuRadioItem: (props: {
  value: string;
  className?: string;
  children?: ReactNode;
}) => any = () => null;
