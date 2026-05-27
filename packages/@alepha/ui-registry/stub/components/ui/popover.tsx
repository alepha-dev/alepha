import type { ReactElement, ReactNode } from "react";

export const Popover: (props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) => any = () => null;
export const PopoverTrigger: (props: {
  asChild?: boolean;
  render?: ReactElement;
  children?: ReactNode;
}) => any = () => null;
export const PopoverContent: (props: {
  className?: string;
  align?: "start" | "center" | "end";
  children?: ReactNode;
}) => any = () => null;
