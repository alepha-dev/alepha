import { cn } from "@alepha/ui";

export interface CommitLinkProps {
  /**
   * The full sha. The short form is what shows; the full one is what the
   * repository resolves.
   */
  sha: string;
  /**
   * The project's repository, when it has one. Absent, the sha is plain text.
   */
  repositoryUrl?: string | null;
  className?: string;
}

/**
 * A commit's short sha, linked to the project's repository when it has one
 * and plain text when it has not: a sha that looks clickable and is not is
 * worse than one that does not (quest #1571).
 *
 * One component for every place a commit shows (the quest rail, the Artifacts
 * table, an app's artifact rows), so the three cannot drift on the URL or on
 * what an unlinked sha looks like (feedback #P2201, #Q2336).
 *
 * `/commit/<sha>` is correct on GitHub and Gitea, and GitLab redirects it to
 * `/-/commit/`, which is why there is no provider setting beside the URL.
 *
 * Leaves Lore and still carries no `ExternalLink` icon, by decision (#Q2222):
 * a monospace sha already reads as "this commit, in the repository", and a
 * list of them with an icon each doubles the weight of what is only an
 * identifier.
 *
 * The click stops at the link, so a row it sits in does not also act on it.
 */
const CommitLink = (props: CommitLinkProps) => {
  const short = props.sha.slice(0, 7);

  if (!props.repositoryUrl) {
    return <code className={cn("font-mono", props.className)}>{short}</code>;
  }

  return (
    <a
      href={`${props.repositoryUrl}/commit/${props.sha}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "font-mono underline-offset-2 hover:underline",
        props.className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {short}
    </a>
  );
};

export default CommitLink;
