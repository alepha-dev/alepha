import * as React from "react";

import { cn } from "./utils.ts";

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  /**
   * A trailing count, rendered after the label.
   *
   * A field rather than something the caller folds into `label`, because the
   * colour has to follow the segment's state and only this component knows
   * it. A count written into the label carries its own class — usually
   * `text-muted-foreground`, which is right on the three inactive segments
   * and nearly invisible on the active one, where the thumb paints
   * `bg-primary` underneath it.
   */
  count?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
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

// Outer-box height + text per size — picked so the control lines up
// pixel-for-pixel with a `<Button>` of the same size token (xs h-6, sm h-7,
// md=Button-default h-8, lg h-9). The box owns the height (border-box, so the
// `p-0.5` + 1px border are included) and the segments stretch to fill it.
const sizeClass: Record<NonNullable<SegmentedProps["size"]>, string> = {
  xs: "h-6 text-xs",
  sm: "h-7 text-[0.8rem]",
  md: "h-8 text-sm",
  lg: "h-9 text-sm",
  xl: "h-11 text-base",
};

// Horizontal padding per size, applied to each segment (height comes from the
// stretched box, not the segment).
const itemPadClass: Record<NonNullable<SegmentedProps["size"]>, string> = {
  xs: "px-2",
  sm: "px-2.5",
  md: "px-3",
  lg: "px-4",
  xl: "px-5",
};

interface ThumbRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * The segment this rect was measured for.
   */
  index: number;
  /**
   * Whether reaching this rect should SLIDE. Only a change of segment does:
   * a re-measure of the same segment (a resize, a popup settling its open
   * animation, the first paint) snaps, or the thumb glides in from wherever
   * the previous measurement put it every time the control appears.
   */
  slide: boolean;
}

export const Segmented = (props: SegmentedProps) => {
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
    // ⚠️ Subtract the container's border, or it is counted twice and the thumb
    // sits one border-width down and to the right of the segment it covers.
    //
    // `getBoundingClientRect()` measures the BORDER box, so this delta includes
    // the border. The thumb is `position: absolute`, whose containing block is
    // the padding box — an origin that already starts inside that same border.
    // Applying a border-box delta from a padding-box origin adds it a second
    // time.
    //
    // At the default 1px border it is a 1px drift on both axes, which reads as
    // the active surface being off-centre: 4px of gap above it and 2px below.
    // Visible, and easy to misdiagnose as missing padding — but padding cannot
    // be the fix, because the drift is equal on the horizontal axis where the
    // box is not symmetric to begin with.
    const parentStyle = getComputedStyle(container);
    const borderLeft = Number.parseFloat(parentStyle.borderLeftWidth) || 0;
    const borderTop = Number.parseFloat(parentStyle.borderTopWidth) || 0;
    // ⚠️ Undo any transform an ANCESTOR is applying while this measures.
    //
    // `getBoundingClientRect()` answers in on-screen pixels, after transforms;
    // the thumb is positioned in layout pixels, before them. Mounted inside a
    // popup that opens with `zoom-in-95`, the first measurement lands while
    // the popup is still at 95%: every offset and width comes back 5% short,
    // and the thumb stays that way, because the transform settling changes no
    // layout and so never wakes the ResizeObserver below. Seen as the "is
    // not" pill of a filter's operator switch sitting 5px left of its label
    // and 5px too narrow, on every reopen.
    //
    // `offsetWidth` is a layout measure of the same border box, so the ratio
    // is exactly the scale in force. Guarded for a detached or hidden node,
    // where both are zero.
    const scale =
      container.offsetWidth > 0 ? parentRect.width / container.offsetWidth : 1;
    setThumb((previous) => ({
      left: (elRect.left - parentRect.left) / scale - borderLeft,
      top: (elRect.top - parentRect.top) / scale - borderTop,
      width: elRect.width / scale,
      height: elRect.height / scale,
      index: activeIndex,
      slide: previous !== null && previous.index !== activeIndex,
    }));
  }, [activeIndex]);

  React.useLayoutEffect(() => {
    // Measures the DOM after it has been committed — there is nothing to
    // derive during render, the geometry does not exist yet.
    // oxlint-disable-next-line react/set-state-in-effect -- measures committed DOM, nothing to derive during render
    measureThumb();
  }, [measureThumb, options.length, size, fullWidth]);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => measureThumb());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measureThumb]);

  const handleSelect = (next: string) => {
    if (controlled === undefined) setUncontrolled(next);
    onChange?.(next);
  };

  /**
   * Arrow-key navigation, which `role="radiogroup"` promises and this did not
   * deliver: a radio group moves between its options with the arrow keys, and
   * moving the selection moves the focus with it. Home and End jump to the
   * ends, and the walk wraps.
   *
   * Disabled options are stepped OVER rather than landed on, so a group whose
   * neighbour is disabled still reaches the one past it. A group with nothing
   * enabled to move to leaves the selection alone rather than looping forever.
   */
  const moveSelection = (from: number, step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next =
        (from + step * i + options.length * options.length) % options.length;
      const opt = options[next];
      if (!opt || opt.disabled) continue;
      handleSelect(opt.value);
      itemRefs.current[next]?.focus();
      return;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const current = options.findIndex((o) => o.value === value);
    const from = current === -1 ? 0 : current;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveSelection(from, 1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveSelection(from, -1);
        return;
      case "Home":
        event.preventDefault();
        moveSelection(-1, 1);
        return;
      case "End":
        event.preventDefault();
        moveSelection(options.length, -1);
        return;
      default:
    }
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      data-slot="segmented"
      className={cn(
        "border-input bg-muted/40 relative box-border inline-flex items-stretch rounded-md border p-0.5",
        sizeClass[size],
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
            // Animate only `transform` — it's GPU-composited in both browsers.
            // Transitioning width/height forces a per-frame reflow + box-shadow
            // repaint on the main thread, which Firefox handles poorly (visible
            // jank); Chrome's fast-paths hide it. Width/height still update, but
            // instantly — for equal-width segments they never change anyway, so
            // only the slide animates.
            //
            // Only while `slide` is set - see `ThumbRect.slide`. This replaces
            // a flag switched on one frame after the first measurement, which
            // kept the first paint still and then animated EVERY later
            // re-measure, including the ones that only correct a position.
            thumb.slide && "transition-transform duration-200 ease-out",
          )}
          style={{
            transform: `translate(${thumb.left}px, ${thumb.top}px)`,
            width: thumb.width,
            height: thumb.height,
            top: 0,
            left: 0,
            willChange: "transform",
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
            onKeyDown={onKeyDown}
            className={cn(
              "relative z-10 inline-flex min-w-0 items-center justify-center rounded-[calc(var(--radius)-2px)] font-medium whitespace-nowrap",
              "transition-colors duration-150 ease-in-out",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              itemPadClass[size],
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
            {opt.count !== undefined && opt.count !== null && (
              <span
                data-slot="segmented-count"
                className={cn(
                  "ml-1.5 tabular-nums",
                  // Derived from the segment's own foreground rather than
                  // from the resting muted token. `/70` keeps the count
                  // secondary to the label on both sides instead of dropping
                  // it to a colour chosen for a different background.
                  active
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
