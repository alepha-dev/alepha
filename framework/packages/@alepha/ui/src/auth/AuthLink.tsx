import type { ComponentProps } from "react";

import { cn } from "../core/utils.ts";

export interface AuthLinkProps extends ComponentProps<"a"> {}

/**
 * A text link of the auth screens ("Forgot password?", "Sign up").
 *
 * Thin underline at rest, full underline on hover, so every such link
 * reads the same whatever sentence it sits in.
 */
export const AuthLink = (props: AuthLinkProps) => {
  const { className, ...rest } = props;
  return (
    <a
      className={cn(
        "text-foreground decoration-foreground/40 hover:decoration-foreground underline decoration-[0.5px] underline-offset-4 transition-colors hover:decoration-1",
        className,
      )}
      {...rest}
    />
  );
};
