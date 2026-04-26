import type { ReactNode } from "react";

export const Command: (props: { children?: ReactNode }) => any = () => null;
export const CommandInput: (props: {
  value?: string;
  onValueChange?: (v: string) => void;
  placeholder?: string;
}) => any = () => null;
export const CommandList: (props: { children?: ReactNode }) => any = () => null;
export const CommandEmpty: (props: { children?: ReactNode }) => any = () =>
  null;
export const CommandGroup: (props: { children?: ReactNode }) => any = () =>
  null;
export const CommandItem: (props: {
  value?: string;
  onSelect?: (value: string) => void;
  children?: ReactNode;
}) => any = () => null;
export const CommandSeparator: (props: Record<string, never>) => any = () =>
  null;
