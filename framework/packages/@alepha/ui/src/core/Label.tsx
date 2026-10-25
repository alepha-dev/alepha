import * as React from "react";

import { cn } from "./utils.ts";

export type LabelProps = React.ComponentProps<"label">;

const Label = (props: LabelProps) => {
  const { className, ...rest } = props;
  return (
    // `htmlFor` arrives through the spread props, which the rule cannot
    // follow.
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- `htmlFor` arrives through the spread
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
};

export { Label };
