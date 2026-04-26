import type { ComponentProps } from "react";

export const Badge: (
  props: ComponentProps<"span"> & {
    variant?: "default" | "secondary" | "destructive" | "outline";
  },
) => any = () => null;
