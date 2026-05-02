"use client";

import { cn } from "@alepha/ui/lib/utils";
import * as React from "react";

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /**
   * Selectable options. Each one renders as a segment.
   */
  options: SegmentedOption[];
  /**
   * Controlled value. Pair with `onChange` for full control.
   */
  value?: string;
  /**
   * Initial value when uncontrolled.
   */
  defaultValue?: string;
  /**
   * Called when the active segment changes.
   */
  onChange?: (value: string) => void;
  /**
   * Visual size — `sm`, `md` (default), or `lg`.
   */
  size?: "sm" | "md" | "lg";
  /**
   * Stretch segments to fill the available width.
   */
  fullWidth?: boolean;
  /**
   * Disable all segments.
   */
  disabled?: boolean;
  /**
   * Optional form name (used when rendered inside a form).
   */
  name?: string;
}

const sizeClass: Record<NonNullable<SegmentedProps["size"]>, string> = {
  sm: "h-8 text-xs px-2.5",
  md: "h-9 text-sm px-3",
  lg: "h-10 text-sm px-4",
};

export function Segmented(props: SegmentedProps) {
  const {
    options,
    value: controlled,
    defaultValue,
    onChange,
    size = "md",
    fullWidth,
    disabled,
    name,
    className,
    ...rest
  } = props;

  const [uncontrolled, setUncontrolled] = React.useState<string | undefined>(
    defaultValue,
  );
  const value = controlled !== undefined ? controlled : uncontrolled;

  const handleSelect = (next: string) => {
    if (controlled === undefined) setUncontrolled(next);
    onChange?.(next);
  };

  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      data-slot="segmented"
      className={cn(
        "inline-flex items-center",
        fullWidth && "flex w-full",
        disabled && "opacity-50",
        className,
      )}
      {...rest}
    >
      {options.map((opt, index) => {
        const active = opt.value === value;
        const itemDisabled = disabled || opt.disabled;
        const isFirst = index === 0;
        const isLast = index === options.length - 1;

        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={itemDisabled || undefined}
            disabled={itemDisabled}
            data-state={active ? "active" : "inactive"}
            data-slot="segmented-item"
            name={name}
            value={opt.value}
            onClick={() => !itemDisabled && handleSelect(opt.value)}
            className={cn(
              "inline-flex min-w-0 items-center justify-center border font-medium whitespace-nowrap",
              "transition-colors duration-150 ease-in-out",
              "focus-visible:ring-ring/50 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-[3px]",
              sizeClass[size],
              isFirst && "rounded-l-md",
              isLast && "rounded-r-md",
              !isFirst && "-ml-px",
              active
                ? "bg-primary text-primary-foreground border-primary z-[1]"
                : "bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground",
              itemDisabled && "cursor-not-allowed opacity-50",
              fullWidth && "flex-1",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
