import type { ReactNode } from "react";

export const Dialog: (props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) => any = () => null;
export const DialogTrigger: (props: {
  asChild?: boolean;
  children?: ReactNode;
}) => any = () => null;
export const DialogContent: (props: {
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DialogHeader: (props: { children?: ReactNode }) => any = () =>
  null;
export const DialogFooter: (props: { children?: ReactNode }) => any = () =>
  null;
export const DialogTitle: (props: { children?: ReactNode }) => any = () => null;
export const DialogDescription: (props: { children?: ReactNode }) => any = () =>
  null;
