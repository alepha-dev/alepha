import type { ComponentProps } from "react";

export const Alert: (
  props: ComponentProps<"div"> & { variant?: "default" | "destructive" },
) => any = () => null;
export const AlertTitle: (props: ComponentProps<"div">) => any = () => null;
export const AlertDescription: (props: ComponentProps<"div">) => any = () =>
  null;
