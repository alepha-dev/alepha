import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "./utils.ts";

export type HoverCardProps = PreviewCardPrimitive.Root.Props;

const HoverCard = (props: HoverCardProps) => {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />;
};

export type HoverCardTriggerProps = PreviewCardPrimitive.Trigger.Props;

const HoverCardTrigger = (props: HoverCardTriggerProps) => {
  return (
    <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  );
};

export type HoverCardContentProps = PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >;

const HoverCardContent = (props: HoverCardContentProps) => {
  const {
    className,
    side = "bottom",
    sideOffset = 4,
    align = "center",
    alignOffset = 4,
    ...rest
  } = props;
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 w-64 origin-(--transform-origin) rounded-lg p-2.5 text-sm shadow-md ring-1 outline-hidden duration-100",
            className,
          )}
          {...rest}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
};

export { HoverCard, HoverCardTrigger, HoverCardContent };
