import type { ComponentProps, ReactNode } from "react";

export const Breadcrumb: (props: ComponentProps<"nav">) => any = () => null;
export const BreadcrumbList: (props: ComponentProps<"ol">) => any = () => null;
export const BreadcrumbItem: (props: ComponentProps<"li">) => any = () => null;
export const BreadcrumbLink: (
  props: ComponentProps<"a"> & { asChild?: boolean },
) => any = () => null;
export const BreadcrumbPage: (props: ComponentProps<"span">) => any = () =>
  null;
export const BreadcrumbSeparator: (props: { children?: ReactNode }) => any =
  () => null;
