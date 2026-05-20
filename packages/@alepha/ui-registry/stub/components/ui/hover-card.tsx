import type { ReactNode } from "react";

export const HoverCard: (props: {
  openDelay?: number;
  closeDelay?: number;
  children?: ReactNode;
}) => any = () => null;
export const HoverCardTrigger: (props: {
  asChild?: boolean;
  children?: ReactNode;
}) => any = () => null;
export const HoverCardContent: (props: {
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children?: ReactNode;
}) => any = () => null;
