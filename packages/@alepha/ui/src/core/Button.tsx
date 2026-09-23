import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Link } from "alepha/react/router";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";

import { cn } from "./utils.ts";

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
 *
 * ---
 *
 * 🧪 Experimental: Blueprint's two axes, `intent` x `variant`.
 *
 * `intent` is the colour, and says what the action MEANS: none (a neutral
 * grey), `primary`, `success`, `warning` or `danger`. `variant` is the
 * weight, and says how loud it is: `solid`, `minimal`, `outlined`, or
 * `link`, text with an underline on hover. Twenty combinations from nine
 * words, where the old list (`default`, `secondary`, `outline`, `ghost`,
 * `destructive`) mixed the two questions into one prop. The old names are
 * gone, not aliased.
 *
 * An omitted intent depends on the weight: a `solid` or `link` button is
 * `primary`, a `minimal` or `outlined` one is `none`. So a bare `<Button>`
 * is solid primary, and `variant="minimal"` is a quiet grey button without
 * having to say so.
 *
 * A solid button has VOLUME: a white gradient over its fill (a background
 * IMAGE, so a caller's `bg-*` replaces the colour and keeps the light), a
 * one-pixel highlight along the top edge, a border darker than the fill and
 * a short drop shadow. Hover darkens the fill rather than fading it, the way
 * Blueprint steps from its 3 to its 2.
 *
 * Every intent colour is a token (`--primary`, `--success`, `--warning`,
 * `--danger`, each with `-foreground` for text on the fill and `-text` for
 * the intent drawn as text on the page), so a theme retints them without
 * touching this file.
 */
const buttonCva = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 not-disabled:active:not-aria-[haspopup]:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress aria-disabled:pointer-events-none aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        solid:
          "bg-linear-to-b from-white/15 to-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.15)]",
        minimal: "",
        outlined: "bg-transparent",
        link: "underline-offset-4 hover:underline",
      },
      intent: {
        none: "",
        primary: "",
        success: "",
        warning: "",
        danger: "",
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
    compoundVariants: [
      {
        variant: "solid",
        intent: "none",
        className:
          "border-border bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)]",
      },
      {
        variant: "solid",
        intent: "primary",
        className:
          "bg-primary text-primary-foreground border-[color-mix(in_oklch,var(--primary),black_25%)] hover:bg-[color-mix(in_oklch,var(--primary),black_12%)]",
      },
      {
        variant: "solid",
        intent: "success",
        className:
          "bg-success text-success-foreground border-[color-mix(in_oklch,var(--success),black_25%)] hover:bg-[color-mix(in_oklch,var(--success),black_12%)]",
      },
      {
        variant: "solid",
        intent: "warning",
        className:
          "bg-warning text-warning-foreground border-[color-mix(in_oklch,var(--warning),black_20%)] hover:bg-[color-mix(in_oklch,var(--warning),black_8%)]",
      },
      {
        variant: "solid",
        intent: "danger",
        className:
          "bg-danger text-danger-foreground border-[color-mix(in_oklch,var(--danger),black_25%)] hover:bg-[color-mix(in_oklch,var(--danger),black_12%)]",
      },
      {
        variant: "minimal",
        intent: "none",
        className:
          "hover:bg-hover hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
      },
      {
        variant: "minimal",
        intent: "primary",
        className:
          "text-primary-text hover:bg-primary/10 aria-expanded:bg-primary/15 dark:hover:bg-primary/20",
      },
      {
        variant: "minimal",
        intent: "success",
        className:
          "text-success-text hover:bg-success/10 aria-expanded:bg-success/15 dark:hover:bg-success/20",
      },
      {
        variant: "minimal",
        intent: "warning",
        className:
          "text-warning-text hover:bg-warning/15 aria-expanded:bg-warning/20 dark:hover:bg-warning/20",
      },
      {
        variant: "minimal",
        intent: "danger",
        className:
          "text-danger-text hover:bg-danger/10 aria-expanded:bg-danger/15 dark:hover:bg-danger/20",
      },
      {
        variant: "outlined",
        intent: "none",
        className:
          "border-border bg-background hover:bg-hover hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-border dark:bg-input/30 dark:hover:bg-hover",
      },
      {
        variant: "outlined",
        intent: "primary",
        className:
          "border-primary/60 text-primary-text hover:bg-primary/10 dark:hover:bg-primary/20",
      },
      {
        variant: "outlined",
        intent: "success",
        className:
          "border-success/60 text-success-text hover:bg-success/10 dark:hover:bg-success/20",
      },
      {
        variant: "outlined",
        intent: "warning",
        className:
          "border-warning/70 text-warning-text hover:bg-warning/15 dark:hover:bg-warning/20",
      },
      {
        variant: "outlined",
        intent: "danger",
        className:
          "border-danger/60 text-danger-text hover:bg-danger/10 dark:hover:bg-danger/20",
      },
      { variant: "link", intent: "none", className: "text-foreground" },
      { variant: "link", intent: "primary", className: "text-primary-text" },
      { variant: "link", intent: "success", className: "text-success-text" },
      { variant: "link", intent: "warning", className: "text-warning-text" },
      { variant: "link", intent: "danger", className: "text-danger-text" },
    ],
    defaultVariants: {
      variant: "solid",
      intent: "primary",
      size: "default",
    },
  },
);

type ButtonCvaProps = VariantProps<typeof buttonCva>;

export type ButtonVariant = NonNullable<ButtonCvaProps["variant"]>;

export type ButtonIntent = NonNullable<ButtonCvaProps["intent"]>;

export interface ButtonVariantProps {
  /**
   * How loud the button is: `solid` (the default), `minimal`, `outlined`
   * or `link`.
   */
  variant?: ButtonVariant | null;
  /**
   * What the action means: `none`, `primary`, `success`, `warning` or
   * `danger`. Omitted, a `solid` or `link` button is primary and a
   * `minimal` or `outlined` one is neutral.
   */
  intent?: ButtonIntent | null;
  size?: ButtonCvaProps["size"];
  className?: string;
}

/**
 * The intent a variant implies when none is given.
 */
const resolveButtonProps = (props: ButtonVariantProps) => {
  const variant = props.variant ?? "solid";
  const intent: ButtonIntent =
    props.intent ??
    (variant === "solid" || variant === "link" ? "primary" : "none");
  return { variant, intent, size: props.size };
};

const buttonVariants = (props: ButtonVariantProps = {}) =>
  buttonCva({ ...resolveButtonProps(props), className: props.className });

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> &
  ButtonVariantProps & {
    /**
     * When true, hides the button's content (icon + label) and shows a single
     * centered spinner in its place, disables the button, and marks it
     * `aria-busy`. The hidden content stays in the layout, so the button keeps
     * its natural width and doesn't resize while busy. Use for form submits and
     * async actions so the click can't be double-fired: every submit in the
     * kit relies on it.
     */
    loading?: boolean;
    /**
     * Makes the button a link to this address, looking exactly as it would
     * as a button: `variant` and `intent` are unchanged by it.
     *
     * An app path renders Alepha's `<Link>`, so a plain click routes in place
     * and a modified click opens a new tab. An absolute URL (`https:`,
     * `mailto:`, `//host`) renders a plain `<a>`, since the router has no
     * route for it. Either way the button stops being a native `<button>`
     * (`nativeButton={false}`) and announces itself as a link
     * (`role="link"`), which is what every hand-written `render={<Link />}`
     * had to spell out.
     */
    href?: string;
    /**
     * The anchor's `target`, with `href` only. `_blank` without a `rel`
     * gets `noreferrer`.
     */
    target?: string;
    /**
     * The anchor's `rel`, with `href` only.
     */
    rel?: string;
  };

/**
 * An address the router cannot route: a scheme (`https:`, `mailto:`) or a
 * protocol-relative `//host`.
 */
const EXTERNAL_HREF = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

const Button = (props: ButtonProps) => {
  const {
    className,
    variant,
    intent,
    size = "default",
    loading = false,
    disabled,
    children,
    href,
    target,
    rel,
    ...rest
  } = props;
  const anchor =
    href === undefined
      ? undefined
      : {
          render: EXTERNAL_HREF.test(href) ? (
            <a
              href={href}
              target={target}
              rel={rel ?? (target === "_blank" ? "noreferrer" : undefined)}
            />
          ) : (
            <Link href={href} target={target} rel={rel} />
          ),
          nativeButton: false,
          role: "link",
        };
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, intent, size, className }), {
        relative: loading,
      })}
      {...rest}
      {...anchor}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2Icon aria-hidden className="animate-spin" />
        </span>
      )}
      <span className={cn("contents", { invisible: loading })}>{children}</span>
    </ButtonPrimitive>
  );
};

export { Button, buttonVariants };
