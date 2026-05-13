import { cn } from "@alepha/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_0_rgba(0,0,0,0.05),0_2px_4px_-1px_rgba(0,0,0,0.12)] hover:bg-primary/90 hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_0_rgba(0,0,0,0.05),0_4px_8px_-2px_rgba(0,0,0,0.18)] active:translate-y-px active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]",
        destructive:
          "bg-destructive text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_0_rgba(0,0,0,0.05),0_2px_4px_-1px_rgba(0,0,0,0.12)] hover:bg-destructive/90 hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_0_rgba(0,0,0,0.05),0_4px_8px_-2px_rgba(0,0,0,0.18)] active:translate-y-px active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)] focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:hover:bg-destructive/80 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-b-2 bg-background shadow-[0_1px_0_rgba(0,0,0,0.02),0_2px_4px_-2px_rgba(0,0,0,0.06)] hover:bg-accent hover:text-accent-foreground hover:-translate-y-px hover:shadow-[0_1px_0_rgba(0,0,0,0.03),0_4px_8px_-2px_rgba(0,0,0,0.1)] active:translate-y-px active:border-b active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_0_rgba(0,0,0,0.04),0_2px_4px_-1px_rgba(0,0,0,0.08)] hover:bg-secondary/80 hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_0_rgba(0,0,0,0.04),0_4px_8px_-2px_rgba(0,0,0,0.12)] active:translate-y-px active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:translate-y-px dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
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
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
