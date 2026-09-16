import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "./utils.ts";

export type SeparatorProps = SeparatorPrimitive.Props;

const Separator = (props: SeparatorProps) => {
  const { className, orientation = "horizontal", ...rest } = props;
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "bg-border shrink-0 data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className,
      )}
      {...rest}
    />
  );
};

export { Separator };
