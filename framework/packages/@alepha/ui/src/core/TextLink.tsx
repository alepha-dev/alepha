import type { ComponentProps } from "react";

import { cn } from "./utils.ts";

export interface TextLinkProps extends ComponentProps<"a"> {
  /**
   * `muted` (the default) is a link standing on its own line of help:
   * muted text that turns to the foreground on hover. `inherit` keeps the
   * colour of what it sits in (a sentence, a table cell, a coloured button)
   * and only darkens to the foreground on hover.
   */
  tone?: "muted" | "inherit";
}

/**
 * The underline every text link of `@alepha/ui` wears: a hairline in the
 * text's own colour at 40% at rest, a full 1px underline on hover. It takes
 * `currentColor`, so it follows any colour change without a transition of
 * its own.
 *
 * For a link that is not a plain `<a>` (a router `Link`, a `Button`'s
 * `link` variant, a table cell) pass these classes, with a colour of its
 * own, rather than restyling the underline by hand.
 */
const textLinkUnderlineClassName =
  "underline decoration-current/40 decoration-[0.5px] underline-offset-4 transition-colors hover:decoration-current hover:decoration-1";

/**
 * The full text link: the underline, on muted text that turns to the
 * foreground on hover.
 */
const textLinkClassName = `text-muted-foreground hover:text-foreground ${textLinkUnderlineClassName}`;

/**
 * A text link: "Forgot password?", "Already registered? Sign in", a link
 * inside a sentence of help.
 *
 * Every text link in an app reads the same this way, whatever sentence it
 * sits in. When a sentence leads to the link ("Don't have an account? Sign
 * up"), make the whole sentence the link: a two-word target inside a muted
 * line is a smaller target and two colours for one action.
 */
const TextLink = (props: TextLinkProps) => {
  const { className, tone, ...rest } = props;
  return (
    <a
      className={cn(
        tone === "inherit"
          ? `hover:text-foreground ${textLinkUnderlineClassName}`
          : textLinkClassName,
        className,
      )}
      {...rest}
    />
  );
};

export { TextLink, textLinkClassName, textLinkUnderlineClassName };
