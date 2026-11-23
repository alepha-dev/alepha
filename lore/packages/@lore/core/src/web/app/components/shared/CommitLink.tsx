import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { useAlepha } from "alepha/react";
import { Link } from "alepha/react/router";

import { CommitLinkRegistry } from "../../registries/CommitLinkRegistry.ts";

export interface CommitLinkProps {
  /**
   * The full sha. The short form is what shows; the full one is what the
   * commit page resolves.
   */
  sha: string;
  /**
   * The repository a trail recorded beside the sha, free text: which Lore
   * repository it names, when it names one.
   */
  repo?: string;
  className?: string;
}

/**
 * A commit's short sha, linked to its page in the project's own Lore
 * repository (#Q4136) and plain text when there is none: a sha that looks
 * clickable and is not is worse than one that does not (quest #1571).
 *
 * One component for every place a commit shows (the quest rail, the
 * Artifacts table, an app's artifact rows), so they cannot drift on the URL
 * or on what an unlinked sha looks like (feedback #P2201, #Q2336). Where it
 * links is Build's to say, through `CommitLinkRegistry`: on with Build's
 * repositories and `code:read`, off otherwise. A project hosted on another
 * forge pushes a read-only copy to Lore to make its commits browsable.
 *
 * The click stops at the link, so a row it sits in does not also act on it.
 */
const CommitLink = (props: CommitLinkProps) => {
  const alepha = useAlepha();
  // Constructed by `LoreCoreWeb` at boot; a spec that mounts a commit
  // without it gets plain text. Fixed for the container's life, so the hook
  // called below is the same on every render.
  const useHref = alepha.has(CommitLinkRegistry)
    ? alepha.inject(CommitLinkRegistry).useHref
    : CommitLinkFallback.useHref;
  const href = useHref(props.sha, props.repo);
  const short = props.sha.slice(0, 7);

  if (!href) {
    return <code className={cn("font-mono", props.className)}>{short}</code>;
  }

  return (
    <Link
      href={href}
      className={cn(
        textLinkUnderlineClassName,
        "hover:text-foreground font-mono",
        props.className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {short}
    </Link>
  );
};

/**
 * What a container without the registry links: nothing.
 */
class CommitLinkFallback {
  public static useHref = (_sha: string, _repo?: string): undefined =>
    undefined;
}

export default CommitLink;
