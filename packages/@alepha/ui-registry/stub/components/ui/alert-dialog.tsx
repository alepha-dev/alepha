import type { ReactNode } from "react";

export const AlertDialog: (props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) => any = () => null;
export const AlertDialogTrigger: (props: {
  asChild?: boolean;
  children?: ReactNode;
}) => any = () => null;
export const AlertDialogContent: (props: { children?: ReactNode }) => any =
  () => null;
export const AlertDialogHeader: (props: { children?: ReactNode }) => any = () =>
  null;
export const AlertDialogFooter: (props: { children?: ReactNode }) => any = () =>
  null;
export const AlertDialogTitle: (props: { children?: ReactNode }) => any = () =>
  null;
export const AlertDialogDescription: (props: { children?: ReactNode }) => any =
  () => null;
export const AlertDialogAction: (props: {
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const AlertDialogCancel: (props: {
  onClick?: () => void;
  children?: ReactNode;
}) => any = () => null;
