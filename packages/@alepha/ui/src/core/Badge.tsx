import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils.ts";

const badgeVariants = cva(
  "group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-[3px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        /**
         * Status chip: the label and the icon stay body text, and the only
         * coloured parts are a near-transparent fill and its border.
         *
         * The caller supplies the hue, because a status palette belongs to
         * the app rather than to the design system:
         * `<Badge variant="tint" className="border-blue-500/40 bg-blue-500/15">`.
         *
         * Distinct from `destructive`, which tints the TEXT as well. That
         * reads as an alarm, which is right for an error and wrong for a
         * neutral fact like "In progress": at chip size, coloured text on a
         * coloured ground is also the pairing that fails contrast first.
         */
        tint: "text-foreground border",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /**
       * The hue of a `tint` badge: a near-transparent fill and a matching
       * border, with the label left as body text.
       *
       * Semantic names rather than colours, so a consumer states what a
       * status MEANS and the system decides how that looks. Lore maps its
       * quest statuses and priorities onto these; anything else mapping the
       * same meanings lands on the same chip without restating the hex.
       *
       * Applied only with `variant="tint"`, through `compoundVariants`
       * below. The other variants paint their own background, and a tone
       * would fight them: before this was enforced, a `default` badge given a
       * tone lost its primary fill to the tone's wash, since tailwind-merge
       * keeps the last `bg-*`.
       */
      tone: {
        neutral: "",
        info: "",
        success: "",
        warning: "",
        danger: "",
      },
    },
    compoundVariants: [
      {
        variant: "tint",
        tone: "neutral",
        class: "border-border bg-muted text-muted-foreground",
      },
      {
        variant: "tint",
        tone: "info",
        class: "border-blue-500/40 bg-blue-500/15",
      },
      {
        variant: "tint",
        tone: "success",
        class: "border-emerald-500/40 bg-emerald-500/15",
      },
      {
        variant: "tint",
        tone: "warning",
        class: "border-amber-500/40 bg-amber-500/15",
      },
      {
        variant: "tint",
        tone: "danger",
        class: "border-red-500/40 bg-red-500/15",
      },
    ],
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  tone,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, tone }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      tone,
    },
  });
}

/**
 * The semantic hues a `tint` badge can wear.
 *
 * Exported because consumers map their own vocabulary onto it (Lore points
 * quest priorities, quest statuses and epic statuses at these names) and
 * every one of those maps needs a type for its record. Derived from the
 * variant rather than retyped, so adding a tone below cannot leave a
 * consumer's map silently incomplete.
 */
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export { Badge, badgeVariants };
