import { cn } from "@alepha/ui/lib/utils";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";

/*
 * ⚠️ `disabled:cursor-not-allowed`, NOT `disabled:pointer-events-none`, which
 * is what this carried and why a disabled button showed a plain arrow: an
 * element with no pointer events never hovers, so it can have no hover cursor.
 *
 * Dropping it costs nothing. Base UI renders a NATIVE `disabled` attribute
 * here (measured: `disabled` + `data-disabled`, no `aria-disabled`), and the
 * browser suppresses click and mousedown on a disabled form control by itself.
 * Every other disabled control in the kit already relies on exactly that -
 * checkbox, textarea, select, input-otp - so this was the outlier rather than
 * the rule.
 *
 * `aria-disabled:pointer-events-none` covers the case the native attribute
 * cannot: a `nativeButton={false}` render, an anchor, where nothing stops a
 * click from navigating. It has no call site today (21 use `nativeButton`,
 * none with `disabled`) and is the guard for the first one that does.
 *
 * `aria-busy:cursor-progress` wins over it while `loading`, which sets both.
 *
 * ⚠️ Every `hover:` and the `active:` nudge is behind `not-disabled:`, and has
 * to stay there. `pointer-events-none` used to suppress them as a side effect
 * of suppressing everything; with the cursor back, a disabled button hovers
 * like any other element and would light up and press down under a pointer it
 * refuses to obey. `not-disabled:` rather than `enabled:` on purpose:
 * `:enabled` only matches form controls, so it would silently kill hover on
 * every `nativeButton={false}` anchor, which is 21 call sites.
 * Busy and forbidden are different promises: the work is happening, and the
 * button will take clicks again when it finishes.
 */
const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 not-disabled:active:not-aria-[haspopup]:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress aria-disabled:pointer-events-none aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground not-disabled:hover:bg-primary/80 shadow-[inset_0_1px_0_0_var(--bevel-raised)]",
        outline:
          "border-border bg-background not-disabled:hover:bg-muted not-disabled:hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:not-disabled:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground shadow-[inset_0_1px_0_0_var(--bevel-raised)] not-disabled:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        ghost:
          "not-disabled:hover:bg-muted not-disabled:hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive not-disabled:hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:not-disabled:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40 shadow-[inset_0_1px_0_0_var(--bevel-raised)]",
        link: "text-primary underline-offset-4 not-disabled:hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * When true, hides the button's content (icon + label) and shows a single
     * centered spinner in its place, disables the button, and marks it
     * `aria-busy`. The hidden content stays in the layout, so the button keeps
     * its natural width and doesn't resize while busy. Use for form submits and
     * async actions so the click can't be double-fired.
     */
    loading?: boolean;
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }), {
        relative: loading,
      })}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2Icon aria-hidden className="animate-spin" />
        </span>
      )}
      <span className={cn("contents", { invisible: loading })}>{children}</span>
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
