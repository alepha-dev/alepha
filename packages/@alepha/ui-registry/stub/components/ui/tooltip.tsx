import type { ReactElement, ReactNode } from "react";

export const TooltipProvider: (props: { children?: ReactNode }) => any = () =>
  null;
export const Tooltip: (props: { children?: ReactNode }) => any = () => null;
export const TooltipTrigger: (props: {
  asChild?: boolean;
  render?: ReactElement;
  children?: ReactNode;
}) => any = () => null;
export const TooltipContent: (props: {
  children?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) => any = () => null;
