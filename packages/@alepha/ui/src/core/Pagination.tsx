import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import * as React from "react";

import { Button } from "./Button.tsx";
import { cn } from "./utils.ts";

export type PaginationProps = React.ComponentProps<"nav">;

const Pagination = (props: PaginationProps) => {
  const { className, ...rest } = props;
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...rest}
    />
  );
};

export type PaginationContentProps = React.ComponentProps<"ul">;

const PaginationContent = (props: PaginationContentProps) => {
  const { className, ...rest } = props;
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...rest}
    />
  );
};

export type PaginationItemProps = React.ComponentProps<"li">;

const PaginationItem = (props: PaginationItemProps) => {
  return <li data-slot="pagination-item" {...props} />;
};

export type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">;

const PaginationLink = (props: PaginationLinkProps) => {
  const { className, isActive, size = "icon", ...rest } = props;
  return (
    <Button
      variant={isActive ? "outline" : "ghost"}
      size={size}
      className={cn(className)}
      nativeButton={false}
      render={
        <a
          aria-current={isActive ? "page" : undefined}
          data-slot="pagination-link"
          data-active={isActive}
          {...rest}
        />
      }
    />
  );
};

export type PaginationPreviousProps = React.ComponentProps<
  typeof PaginationLink
> & { text?: string };

const PaginationPrevious = (props: PaginationPreviousProps) => {
  const { className, text = "Previous", ...rest } = props;
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn("pl-1.5!", className)}
      {...rest}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      <span className="hidden sm:block">{text}</span>
    </PaginationLink>
  );
};

export type PaginationNextProps = React.ComponentProps<
  typeof PaginationLink
> & { text?: string };

const PaginationNext = (props: PaginationNextProps) => {
  const { className, text = "Next", ...rest } = props;
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn("pr-1.5!", className)}
      {...rest}
    >
      <span className="hidden sm:block">{text}</span>
      <ChevronRightIcon data-icon="inline-end" />
    </PaginationLink>
  );
};

export type PaginationEllipsisProps = React.ComponentProps<"span"> & {
  /**
   * What a screen reader hears for the gap. The primitive knows no language,
   * so a caller that has one passes it translated.
   */
  label?: string;
};

const PaginationEllipsis = (props: PaginationEllipsisProps) => {
  const { className, label = "More pages", ...rest } = props;
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">{label}</span>
    </span>
  );
};

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
