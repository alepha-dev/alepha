import { cn } from "@alepha/ui/lib/utils";
import { ExternalLink } from "lucide-react";
import type { ComponentProps } from "react";

export interface OutboundLinkProps extends Omit<ComponentProps<"a">, "target"> {
  href: string;
}

/**
 * A link that leaves Lore: a new tab, and the trailing `ExternalLink` icon
 * that says so (feedback #2185, #Q2222).
 *
 * Every such link used to be an `<a target="_blank">` written by hand, and
 * that is how the docs links on the empty states came to look like in-app
 * links while opening another site. This owns the three things each copy
 * had to remember: `target`, `rel` and the icon, styled like the app URL on
 * `/apps` (`size-3`, `gap-1`).
 *
 * The icon means "this leaves Lore", so it belongs on nothing that stays:
 * an in-app route or a same-origin download is a plain anchor.
 *
 * ⚠️ The label is what truncates, never the anchor. An anchor that
 * truncates as a whole clips its trailing icon first, which is the one part
 * that cannot be guessed from what survives (see `ProjectApps`).
 *
 * `rel` defaults to `noreferrer`, which implies `noopener` and is what every
 * one of these links carried by hand; a caller that also wants `nofollow`
 * (a link to somebody's deployed app) passes its own.
 */
export const OutboundLink = (props: OutboundLinkProps) => {
  const { children, className, rel, ...anchor } = props;

  return (
    <a
      {...anchor}
      target="_blank"
      rel={rel ?? "noreferrer"}
      className={cn("inline-flex max-w-full items-center gap-1", className)}
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
};
