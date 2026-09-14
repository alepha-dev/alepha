import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import * as React from "react";

import { Button } from "./Button.tsx";
import { cn } from "./utils.ts";

export type DialogProps = DialogPrimitive.Root.Props;

const Dialog = (props: DialogProps) => {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
};

export type DialogTriggerProps = DialogPrimitive.Trigger.Props;

const DialogTrigger = (props: DialogTriggerProps) => {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
};

export type DialogPortalProps = DialogPrimitive.Portal.Props;

const DialogPortal = (props: DialogPortalProps) => {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
};

export type DialogCloseProps = DialogPrimitive.Close.Props;

const DialogClose = (props: DialogCloseProps) => {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
};

export type DialogOverlayProps = DialogPrimitive.Backdrop.Props;

const DialogOverlay = (props: DialogOverlayProps) => {
  const { className, ...rest } = props;
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...rest}
    />
  );
};

export type DialogContentProps = DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
};

const DialogContent = (props: DialogContentProps) => {
  const { className, children, showCloseButton = true, ...rest } = props;
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-4 text-sm ring-1 duration-100 outline-none sm:max-w-sm",
          className,
        )}
        {...rest}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
};

export type DialogHeaderProps = React.ComponentProps<"div">;

const DialogHeader = (props: DialogHeaderProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...rest}
    />
  );
};

export type DialogFooterProps = React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
};

const DialogFooter = (props: DialogFooterProps) => {
  const { className, showCloseButton = false, children, ...rest } = props;
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "bg-muted/50 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...rest}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
};

export type DialogTitleProps = DialogPrimitive.Title.Props;

const DialogTitle = (props: DialogTitleProps) => {
  const { className, ...rest } = props;
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...rest}
    />
  );
};

export type DialogDescriptionProps = DialogPrimitive.Description.Props;

const DialogDescription = (props: DialogDescriptionProps) => {
  const { className, ...rest } = props;
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...rest}
    />
  );
};

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
