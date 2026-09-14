import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "./utils.ts";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertProps = React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants>;

const Alert = (props: AlertProps) => {
  const { className, variant, ...rest } = props;
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...rest}
    />
  );
};

export type AlertTitleProps = React.ComponentProps<"div">;

const AlertTitle = (props: AlertTitleProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "[&_a]:hover:text-foreground font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertDescriptionProps = React.ComponentProps<"div">;

const AlertDescription = (props: AlertDescriptionProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground [&_a]:hover:text-foreground text-sm text-balance md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertActionProps = React.ComponentProps<"div">;

const AlertAction = (props: AlertActionProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...rest}
    />
  );
};

export { Alert, AlertTitle, AlertDescription, AlertAction };
