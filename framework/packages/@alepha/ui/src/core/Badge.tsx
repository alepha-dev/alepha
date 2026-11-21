import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { textLinkUnderlineClassName } from "./TextLink.tsx";
import { cn } from "./utils.ts";

const badgeVariants = cva(
  "group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-danger aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-[3px] has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-danger/10 text-danger-text focus-visible:ring-danger/20 dark:bg-danger/20 dark:focus-visible:ring-danger/40 [a]:hover:bg-danger/20",
        outline:
          "border-border text-foreground [a]:hover:bg-hover [a]:hover:text-muted-foreground",
        /**
         * Status or category chip: the label and the icon stay body text, and
         * the only coloured parts are a near-transparent fill and its border.
         * The hue is always a `tone`, never classes passed by the caller, so
         * every tinted chip in an app is the same chip.
         *
         * Distinct from `destructive`, which tints the TEXT as well. That
         * reads as an alarm, which is right for an error and wrong for a
         * neutral fact like "In progress": at chip size, coloured text on a
         * coloured ground is also the pairing that fails contrast first.
         */
        tint: "text-foreground border",
        ghost: "hover:bg-hover hover:text-muted-foreground dark:hover:bg-hover",
        link: `text-primary ${textLinkUnderlineClassName}`,
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
       *
       * success, warning and danger paint from the signal tokens, not fixed
       * Tailwind hues, so colour-blind mode (`:root.cvd`) repaints them.
       * info stays blue: blue is already safe under every common deficiency.
       *
       * The hue tones after them (slate to pink) name a colour, not a
       * meaning: for categories a user or an app tells apart by colour, such
       * as tags or kinds, where a semantic tone would claim a success or a
       * danger that is not there. Same fill and border strengths as the
       * semantic ones.
       */
      tone: {
        neutral: "",
        info: "",
        success: "",
        warning: "",
        danger: "",
        slate: "",
        blue: "",
        green: "",
        amber: "",
        orange: "",
        red: "",
        violet: "",
        cyan: "",
        pink: "",
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
        class: "border-success/40 bg-success/15",
      },
      {
        variant: "tint",
        tone: "warning",
        class: "border-warning/40 bg-warning/15",
      },
      {
        variant: "tint",
        tone: "danger",
        class: "border-danger/40 bg-danger/15",
      },
      {
        variant: "tint",
        tone: "slate",
        class: "border-slate-500/40 bg-slate-500/15",
      },
      {
        variant: "tint",
        tone: "blue",
        class: "border-blue-500/40 bg-blue-500/15",
      },
      {
        variant: "tint",
        tone: "green",
        class: "border-emerald-500/40 bg-emerald-500/15",
      },
      {
        variant: "tint",
        tone: "amber",
        class: "border-amber-500/40 bg-amber-500/15",
      },
      {
        variant: "tint",
        tone: "orange",
        class: "border-orange-500/40 bg-orange-500/15",
      },
      {
        variant: "tint",
        tone: "red",
        class: "border-red-500/40 bg-red-500/15",
      },
      {
        variant: "tint",
        tone: "violet",
        class: "border-violet-500/40 bg-violet-500/15",
      },
      {
        variant: "tint",
        tone: "cyan",
        class: "border-cyan-500/40 bg-cyan-500/15",
      },
      {
        variant: "tint",
        tone: "pink",
        class: "border-pink-500/40 bg-pink-500/15",
      },
    ],
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants>;

const Badge = (props: BadgeProps) => {
  const { className, variant = "default", tone, render, ...rest } = props;
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, tone }), className),
      },
      rest,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      tone,
    },
  });
};

/**
 * The hues a `tint` badge can wear: semantic ones (neutral to danger), then
 * plain colours for categories (slate to pink).
 *
 * Exported because consumers map their own vocabulary onto it (Lore points
 * quest priorities, quest statuses and epic statuses at these names) and
 * every one of those maps needs a type for its record. Derived from the
 * variant rather than retyped, so adding a tone below cannot leave a
 * consumer's map silently incomplete.
 */
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export { Badge, badgeVariants };
