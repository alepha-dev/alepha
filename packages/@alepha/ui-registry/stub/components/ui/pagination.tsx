import type { ComponentProps } from "react";

export const Pagination: (props: ComponentProps<"nav">) => any = () => null;
export const PaginationContent: (props: ComponentProps<"ul">) => any = () =>
  null;
export const PaginationItem: (props: ComponentProps<"li">) => any = () => null;
export const PaginationLink: (
  props: ComponentProps<"a"> & { isActive?: boolean; size?: string },
) => any = () => null;
export const PaginationPrevious: (
  props: ComponentProps<"a"> & { isActive?: boolean; size?: string },
) => any = () => null;
export const PaginationNext: (
  props: ComponentProps<"a"> & { isActive?: boolean; size?: string },
) => any = () => null;
export const PaginationFirst: (
  props: ComponentProps<"a"> & { isActive?: boolean; size?: string },
) => any = () => null;
export const PaginationLast: (
  props: ComponentProps<"a"> & { isActive?: boolean; size?: string },
) => any = () => null;
export const PaginationEllipsis: (props: ComponentProps<"span">) => any = () =>
  null;
