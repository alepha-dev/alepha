import { cn } from "@alepha/ui/lib/utils";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";

/*
 * ⚠️ `disabled:cursor-not-allowed`, NOT `disabled:pointer-events-none`, which
 * is what this used to carry and why a disabled button showed a plain arrow:
 * an element with no pointer events is never a hit target, so it can have no
 * cursor of its own.
 *
 * Dropping it costs nothing. Base UI renders a NATIVE `disabled` attribute
 * here, and the browser suppresses click and mousedown on a disabled form
 * control by itself. Every other disabled control in the kit already relies on
 * exactly that - checkbox, switch, textarea, select, command, input-otp - so
 * the button was the outlier rather than the rule.
 *
 * `aria-disabled:pointer-events-none` covers the case the native attribute
 * cannot: a `nativeButton={false}` render, an anchor, where nothing stops a
 * click from navigating.
 *
 * The price is that a disabled button now takes its variant's hover fill under
 * the pointer, at `opacity-50`. That is deliberate, and it is what a disabled
 * `select-trigger` has always done. See the warning below for why the obvious
 * fix is worse than the wart.
 *
 * ⚠️ DO NOT guard the hover utilities with `not-disabled:`. It was tried, and
 * it broke the fill of every caller that overrides one - 94 call sites, of
 * which `useDialog`'s destructive confirm was the loudest: a red delete button
 * that turned near-white the moment you reached for it.
 *
 * The variant's classes and the caller's are reconciled by tailwind-merge,
 * which decides two classes are the same thing by utility group AND modifier
 * prefix. `hover:bg-primary/80` and a caller's `hover:bg-destructive/90` match,
 * so the caller's replaces it. Prefix the variant's with `not-disabled:` and
 * they no longer match, both survive into the class list, and the browser
 * breaks the tie on specificity - where `:not(:disabled):hover` outranks a
 * plain `:hover` and the variant wins a fight it is supposed to lose.
 *
 * So: adding a class here is safe. Adding a MODIFIER PREFIX to a class callers
 * override is not. `cursor-*` has no overrides anywhere in the kit, which is
 * what makes the two above safe. `hover:bg-*` is the most overridden class in
 * it.
 *
 * `not-disabled:` on the `active:` nudge is fine for the same reason: the
 * press-down has three call sites and none of them override it. A disabled
 * button that sinks under the pointer is the one part of this worth
 * suppressing, since it promises a click that will not happen.
 *
 * `aria-busy:cursor-progress` wins while `loading`, which sets both attributes:
 * busy and forbidden are different promises. The work is happening, and the
 * button will take clicks again when it finishes.
 *
 * ---
 *
 * ℹ️ A caller that overrides the font size DOES lose the line height with it,
 * and it does NOT move the label. Both halves were measured, because the first
 * one on its own reads like a bug and is the third-most-reported thing about
 * this file.
 *
 * `text-sm` is a PAIR in Tailwind v4: font size and the line height that goes
 * with it. tailwind-merge groups it with a caller's `text-[12.5px]` and keeps
 * only the caller's, so the pair's second half is dropped and the line height
 * becomes the 1.5 default - 18.75px rather than 20px. That much is real, and
 * `size="sm"` does it too, since it is `text-[0.8rem]`, also arbitrary.
 *
 * It cannot decentre anything. Half-leading is symmetric: the inline box sits
 * in the middle of the line box whatever the line height, the line box is
 * centred by `items-center`, and the fixed `h-8` is unaffected either way.
 * Measured on the reported button (Chrome, macOS, the same `-apple-system`
 * stack production resolves), ink centre against button centre:
 *
 *   text-sm         20px    line box   +0.404px
 *   text-[12.5px]   18.75px line box   -0.050px
 *
 * The override is marginally BETTER centred. What remains is the font's own
 * ascent/descent asymmetry, which is under half a pixel and is the same
 * effect at every size.
 *
 * So: do not add a `leading-*` here to "fix" it. It would change nothing
 * visible, at 94 call sites, on a base the notes above already record as the
 * risky place to edit. See #Q2157.
 */
const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 not-disabled:active:not-aria-[haspopup]:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress aria-disabled:pointer-events-none aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
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
