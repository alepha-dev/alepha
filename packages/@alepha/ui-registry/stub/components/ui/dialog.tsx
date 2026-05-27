import type { ReactElement, ReactNode } from "react";

export const Dialog: (props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) => any = () => null;
export const DialogTrigger: (props: {
  asChild?: boolean;
  render?: ReactElement;
  children?: ReactNode;
}) => any = () => null;
export const DialogContent: (props: {
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DialogHeader: (props: {
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DialogFooter: (props: {
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DialogTitle: (props: {
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const DialogDescription: (props: {
  className?: string;
  children?: ReactNode;
}) => any = () => null;
