"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

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
   * Visual size — `xs`, `sm`, `md` (default), `lg`, or `xl`.
   */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /**
   * Stretch segments to fill the available width.
   */
  fullWidth?: boolean;
  /**
   * Disable all segments.
   */
  disabled?: boolean;
  /**
   * Render 1px separators between inactive segments. Defaults to `true`.
   */
  dividers?: boolean;
  /**
   * Optional form name (used when rendered inside a form).
   */
  name?: string;
}

const sizeClass: Record<NonNullable<SegmentedProps["size"]>, string> = {
  xs: "h-7 text-xs px-2",
  sm: "h-8 text-xs px-2.5",
  md: "h-9 text-sm px-3",
  lg: "h-10 text-sm px-4",
  xl: "h-11 text-base px-5",
};

interface ThumbRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function Segmented(props: SegmentedProps) {
  const {
    options,
    value: controlled,
    defaultValue,
    onChange,
    size = "md",
    fullWidth,
    disabled,
    dividers = true,
    name,
    className,
    ...rest
  } = props;

  const [uncontrolled, setUncontrolled] = React.useState<string | undefined>(
    defaultValue,
  );
  const value = controlled !== undefined ? controlled : uncontrolled;

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = React.useState<ThumbRect | null>(null);
  const [animate, setAnimate] = React.useState(false);

  const activeIndex = options.findIndex((opt) => opt.value === value);

  const measureThumb = React.useCallback(() => {
    if (activeIndex < 0) {
      setThumb(null);
      return;
    }
    const el = itemRefs.current[activeIndex];
    const container = containerRef.current;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const parentRect = container.getBoundingClientRect();
    setThumb({
      left: elRect.left - parentRect.left,
      top: elRect.top - parentRect.top,
      width: elRect.width,
      height: elRect.height,
    });
  }, [activeIndex]);

  React.useLayoutEffect(() => {
    measureThumb();
  }, [measureThumb, options.length, size, fullWidth]);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => measureThumb());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measureThumb]);

  // Enable animation only after the first measurement so the thumb doesn't
  // slide from (0,0) on initial paint.
  React.useEffect(() => {
    if (thumb && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(id);
    }
  }, [thumb, animate]);

  const handleSelect = (next: string) => {
    if (controlled === undefined) setUncontrolled(next);
    onChange?.(next);
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      data-slot="segmented"
      className={cn(
        "border-input bg-muted/40 relative inline-flex items-center rounded-md border p-1",
        fullWidth && "flex w-full",
        disabled && "opacity-50",
        className,
      )}
      {...rest}
    >
      {thumb && (
        <span
          aria-hidden
          data-slot="segmented-thumb"
          className={cn(
            "bg-primary pointer-events-none absolute rounded-[calc(var(--radius)-2px)] shadow-sm",
            animate &&
              "transition-[transform,width,height] duration-200 ease-out",
          )}
          style={{
            transform: `translate(${thumb.left}px, ${thumb.top}px)`,
            width: thumb.width,
            height: thumb.height,
            top: 0,
            left: 0,
          }}
        />
      )}
      {options.map((opt, index) => {
        const active = opt.value === value;
        const itemDisabled = disabled || opt.disabled;
        const showDivider =
          dividers && index > 0 && !active && index - 1 !== activeIndex;

        return (
          <button
            key={opt.value}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
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
              "relative z-10 inline-flex min-w-0 items-center justify-center rounded-[calc(var(--radius)-2px)] font-medium whitespace-nowrap",
              "transition-colors duration-150 ease-in-out",
              "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]",
              sizeClass[size],
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
              itemDisabled && "cursor-not-allowed opacity-50",
              fullWidth && "flex-1",
              showDivider &&
                "before:bg-border before:absolute before:inset-y-1.5 before:left-0 before:w-px before:content-['']",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
