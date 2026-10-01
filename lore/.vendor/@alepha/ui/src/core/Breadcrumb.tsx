import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import * as React from "react";

import { cn } from "./utils.ts";

export type BreadcrumbProps = React.ComponentProps<"nav">;

const Breadcrumb = (props: BreadcrumbProps) => {
  const { className, ...rest } = props;
  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      className={cn(className)}
      {...rest}
    />
  );
};

export type BreadcrumbListProps = React.ComponentProps<"ol">;

const BreadcrumbList = (props: BreadcrumbListProps) => {
  const { className, ...rest } = props;
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm wrap-break-word",
        className,
      )}
      {...rest}
    />
  );
};

export type BreadcrumbItemProps = React.ComponentProps<"li">;

const BreadcrumbItem = (props: BreadcrumbItemProps) => {
  const { className, ...rest } = props;
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1", className)}
      {...rest}
    />
  );
};

export type BreadcrumbLinkProps = useRender.ComponentProps<"a">;

const BreadcrumbLink = (props: BreadcrumbLinkProps) => {
  const { className, render, ...rest } = props;
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn("hover:text-foreground transition-colors", className),
      },
      rest,
    ),
    render,
    state: {
      slot: "breadcrumb-link",
    },
  });
};

export type BreadcrumbPageProps = React.ComponentProps<"span">;

const BreadcrumbPage = (props: BreadcrumbPageProps) => {
  const { className, ...rest } = props;
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("text-foreground font-normal", className)}
      {...rest}
    />
  );
};

export type BreadcrumbSeparatorProps = React.ComponentProps<"li">;

const BreadcrumbSeparator = (props: BreadcrumbSeparatorProps) => {
  const { children, className, ...rest } = props;
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...rest}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  );
};

export type BreadcrumbEllipsisProps = React.ComponentProps<"span">;

const BreadcrumbEllipsis = (props: BreadcrumbEllipsisProps) => {
  const { className, ...rest } = props;
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn(
        "flex size-5 items-center justify-center [&>svg]:size-4",
        className,
      )}
      {...rest}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More</span>
    </span>
  );
};

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
