import * as React from "react";

import { cn } from "./utils.ts";

export type TextareaProps = React.ComponentProps<"textarea">;

const Textarea = (props: TextareaProps) => {
  const { className, style, ...rest } = props;
  // `field-sizing-content` sizes the box to its text, and the browser then
  // ignores `rows`: every `rows` passed here did nothing. It is kept as a
  // floor instead, `rows` lines plus the padding and border and never below
  // 4rem, while the box still grows with what is typed. A variable rather
  // than an inline `min-height`, so a caller's `min-h-*` class still wins.
  const rowsStyle =
    props.rows != null
      ? ({
          "--textarea-min-h": `max(4rem, calc(${props.rows}lh + 1rem + 2px))`,
        } as React.CSSProperties)
      : undefined;
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-border placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-danger aria-invalid:ring-danger/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-danger/50 dark:aria-invalid:ring-danger/40 flex field-sizing-content min-h-[var(--textarea-min-h,4rem)] w-full rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
        className,
      )}
      style={rowsStyle ? { ...rowsStyle, ...style } : style}
      {...rest}
    />
  );
};

export { Textarea };
