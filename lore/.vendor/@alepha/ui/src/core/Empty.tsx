import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils.ts";

export type EmptyProps = React.ComponentProps<"div">;

const Empty = (props: EmptyProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance",
        className,
      )}
      {...rest}
    />
  );
};

export type EmptyHeaderProps = React.ComponentProps<"div">;

const EmptyHeader = (props: EmptyHeaderProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...rest}
    />
  );
};

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type EmptyMediaProps = React.ComponentProps<"div"> &
  VariantProps<typeof emptyMediaVariants>;

const EmptyMedia = (props: EmptyMediaProps) => {
  const { className, variant = "default", ...rest } = props;
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...rest}
    />
  );
};

export type EmptyTitleProps = React.ComponentProps<"div">;

const EmptyTitle = (props: EmptyTitleProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-heading text-sm font-medium tracking-tight",
        className,
      )}
      {...rest}
    />
  );
};

export type EmptyDescriptionProps = React.ComponentProps<"p">;

const EmptyDescription = (props: EmptyDescriptionProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className,
      )}
      {...rest}
    />
  );
};

export type EmptyContentProps = React.ComponentProps<"div">;

const EmptyContent = (props: EmptyContentProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance",
        className,
      )}
      {...rest}
    />
  );
};

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
};
