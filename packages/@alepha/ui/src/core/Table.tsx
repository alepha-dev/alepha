import * as React from "react";

import { cn } from "./utils.ts";

export type TableProps = React.ComponentProps<"table">;

const Table = (props: TableProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...rest}
      />
    </div>
  );
};

export type TableHeaderProps = React.ComponentProps<"thead">;

const TableHeader = (props: TableHeaderProps) => {
  const { className, ...rest } = props;
  return (
    <thead
      data-slot="table-header"
      // The header keeps as a permanent fill the tint a row only borrows on
      // hover: a header is not actionable, so lighting up under the cursor
      // promised an interaction it does not have.
      className={cn("bg-muted/50 [&_tr]:border-b", className)}
      {...rest}
    />
  );
};

export type TableBodyProps = React.ComponentProps<"tbody">;

const TableBody = (props: TableBodyProps) => {
  const { className, ...rest } = props;
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...rest}
    />
  );
};

export type TableFooterProps = React.ComponentProps<"tfoot">;

const TableFooter = (props: TableFooterProps) => {
  const { className, ...rest } = props;
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...rest}
    />
  );
};

export type TableRowProps = React.ComponentProps<"tr">;

const TableRow = (props: TableRowProps) => {
  const { className, ...rest } = props;
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // ⚠️ `bg-hover-weak`, not `bg-hover`: a row is the width of the table and
        // passes under the pointer on the way to anything else, so the full
        // state layer reads as a flash across the page. Every other clickable
        // surface uses `bg-hover`; this is the documented exception.
        "hover:bg-hover-weak has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className,
      )}
      {...rest}
    />
  );
};

export type TableHeadProps = React.ComponentProps<"th">;

const TableHead = (props: TableHeadProps) => {
  const { className, ...rest } = props;
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...rest}
    />
  );
};

export type TableCellProps = React.ComponentProps<"td">;

const TableCell = (props: TableCellProps) => {
  const { className, ...rest } = props;
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...rest}
    />
  );
};

export type TableCaptionProps = React.ComponentProps<"caption">;

const TableCaption = (props: TableCaptionProps) => {
  const { className, ...rest } = props;
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...rest}
    />
  );
};

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
