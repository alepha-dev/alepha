import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { useStore } from "alepha/react";

import { repositoryLinks } from "../../../../api/schemas/repositoryForge.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";

export interface CommitLinkProps {
  /**
   * The full sha. The short form is what shows; the full one is what the
   * forge resolves.
   */
  sha: string;
  /**
   * The repository the trail recorded beside the sha, free text. Kept for
   * the rows that carry it; the link is built from the project's
   * `repositoryUrl` alone.
   */
  repo?: string;
  className?: string;
}

/**
 * A commit's short sha, linked to its page on the project's forge when the
 * project names a repository Lore knows how to link (#Q4217,
 * `repositoryForge.ts`), and plain text otherwise: a sha that looks
 * clickable and is not is worse than one that does not (quest #1571).
 *
 * One component for every place a commit shows (the quest rail, the
 * Artifacts table, an app's artifact rows), so they cannot drift on the URL
 * or on what an unlinked sha looks like (feedback #P2201, #Q2336). It reads
 * the project from `currentProjectAtom`, which every project page sets.
 *
 * Leaves Lore and still carries no `ExternalLink` icon, by decision (#Q2222):
 * a monospace sha already reads as "this commit, in the repository".
 *
 * The click stops at the link, so a row it sits in does not also act on it.
 */
const CommitLink = (props: CommitLinkProps) => {
  const [project] = useStore(currentProjectAtom);
  const links = repositoryLinks(project?.repositoryUrl);
  const short = props.sha.slice(0, 7);

  if (!links) {
    return <code className={cn("font-mono", props.className)}>{short}</code>;
  }

  return (
    <a
      href={links.commit(props.sha)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        textLinkUnderlineClassName,
        "hover:text-foreground font-mono",
        props.className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {short}
    </a>
  );
};

export default CommitLink;
