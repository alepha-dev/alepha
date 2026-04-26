import type { ComponentProps } from "react";

export const Separator: (
  props: ComponentProps<"div"> & {
    orientation?: "horizontal" | "vertical";
    decorative?: boolean;
  },
) => any = () => null;
