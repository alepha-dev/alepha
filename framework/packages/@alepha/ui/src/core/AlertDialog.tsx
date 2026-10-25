import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import * as React from "react";

import { Button } from "./Button.tsx";
import { cn } from "./utils.ts";

export type AlertDialogProps = AlertDialogPrimitive.Root.Props;

const AlertDialog = (props: AlertDialogProps) => {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
};

export type AlertDialogTriggerProps = AlertDialogPrimitive.Trigger.Props;

const AlertDialogTrigger = (props: AlertDialogTriggerProps) => {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
};

export type AlertDialogPortalProps = AlertDialogPrimitive.Portal.Props;

const AlertDialogPortal = (props: AlertDialogPortalProps) => {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
};

export type AlertDialogOverlayProps = AlertDialogPrimitive.Backdrop.Props;

const AlertDialogOverlay = (props: AlertDialogOverlayProps) => {
  const { className, ...rest } = props;
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertDialogContentProps = AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm";
};

const AlertDialogContent = (props: AlertDialogContentProps) => {
  const { className, size = "default", ...rest } = props;
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-4 ring-1 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm",
          className,
        )}
        {...rest}
      />
    </AlertDialogPortal>
  );
};

export type AlertDialogHeaderProps = React.ComponentProps<"div">;

const AlertDialogHeader = (props: AlertDialogHeaderProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertDialogFooterProps = React.ComponentProps<"div">;

const AlertDialogFooter = (props: AlertDialogFooterProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "bg-muted/50 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertDialogMediaProps = React.ComponentProps<"div">;

const AlertDialogMedia = (props: AlertDialogMediaProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "bg-muted mb-2 inline-flex size-10 items-center justify-center rounded-md sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertDialogTitleProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Title
>;

const AlertDialogTitle = (props: AlertDialogTitleProps) => {
  const { className, ...rest } = props;
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "font-heading text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertDialogDescriptionProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Description
>;

const AlertDialogDescription = (props: AlertDialogDescriptionProps) => {
  const { className, ...rest } = props;
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm text-balance md:text-pretty *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...rest}
    />
  );
};

export type AlertDialogActionProps = React.ComponentProps<typeof Button>;

const AlertDialogAction = (props: AlertDialogActionProps) => {
  const { className, ...rest } = props;
  return (
    <Button
      data-slot="alert-dialog-action"
      className={cn(className)}
      {...rest}
    />
  );
};

export type AlertDialogCancelProps = AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">;

const AlertDialogCancel = (props: AlertDialogCancelProps) => {
  const { className, variant = "outlined", size = "default", ...rest } = props;
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...rest}
    />
  );
};

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
