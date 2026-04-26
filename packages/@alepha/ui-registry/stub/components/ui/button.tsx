/**
 * Type-only stub of stock shadcn `<Button>` for typecheck during block authoring.
 * The real component is installed by `shadcn add` into the consumer's repo.
 */
import type { ComponentProps } from "react";

export type ButtonProps = ComponentProps<"button"> & {
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
};

export const Button: (props: ButtonProps) => any = () => null;
