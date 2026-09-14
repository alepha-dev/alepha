import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import * as React from "react";

import { Button } from "./Button.tsx";
import { cn } from "./utils.ts";

export type SheetProps = SheetPrimitive.Root.Props;

const Sheet = (props: SheetProps) => {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
};

export type SheetTriggerProps = SheetPrimitive.Trigger.Props;

const SheetTrigger = (props: SheetTriggerProps) => {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
};

export type SheetCloseProps = SheetPrimitive.Close.Props;

const SheetClose = (props: SheetCloseProps) => {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
};

export type SheetPortalProps = SheetPrimitive.Portal.Props;

const SheetPortal = (props: SheetPortalProps) => {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
};

export type SheetOverlayProps = SheetPrimitive.Backdrop.Props;

const SheetOverlay = (props: SheetOverlayProps) => {
  const { className, ...rest } = props;
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...rest}
    />
  );
};

export type SheetContentProps = SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
};

const SheetContent = (props: SheetContentProps) => {
  const {
    className,
    children,
    side = "right",
    showCloseButton = true,
    ...rest
  } = props;
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "bg-popover text-popover-foreground fixed z-50 flex flex-col gap-4 bg-clip-padding text-sm shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className,
        )}
        {...rest}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
};

export type SheetHeaderProps = React.ComponentProps<"div">;

const SheetHeader = (props: SheetHeaderProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...rest}
    />
  );
};

export type SheetFooterProps = React.ComponentProps<"div">;

const SheetFooter = (props: SheetFooterProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...rest}
    />
  );
};

export type SheetTitleProps = SheetPrimitive.Title.Props;

const SheetTitle = (props: SheetTitleProps) => {
  const { className, ...rest } = props;
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-foreground text-base font-medium",
        className,
      )}
      {...rest}
    />
  );
};

export type SheetDescriptionProps = SheetPrimitive.Description.Props;

const SheetDescription = (props: SheetDescriptionProps) => {
  const { className, ...rest } = props;
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...rest}
    />
  );
};

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
