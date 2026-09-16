import * as React from "react";

import { cn } from "./utils.ts";

export type CardProps = React.ComponentProps<"div"> & {
  size?: "default" | "sm";
};

const Card = (props: CardProps) => {
  const { className, size = "default", ...rest } = props;
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card bg-card text-card-foreground ring-foreground/10 flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm ring-1 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className,
      )}
      {...rest}
    />
  );
};

export type CardHeaderProps = React.ComponentProps<"div">;

const CardHeader = (props: CardHeaderProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...rest}
    />
  );
};

export type CardTitleProps = React.ComponentProps<"div">;

const CardTitle = (props: CardTitleProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...rest}
    />
  );
};

export type CardDescriptionProps = React.ComponentProps<"div">;

const CardDescription = (props: CardDescriptionProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...rest}
    />
  );
};

export type CardActionProps = React.ComponentProps<"div">;

const CardAction = (props: CardActionProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...rest}
    />
  );
};

export type CardContentProps = React.ComponentProps<"div">;

const CardContent = (props: CardContentProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...rest}
    />
  );
};

export type CardFooterProps = React.ComponentProps<"div">;

const CardFooter = (props: CardFooterProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "bg-muted/50 flex items-center rounded-b-xl border-t p-(--card-spacing)",
        className,
      )}
      {...rest}
    />
  );
};

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
