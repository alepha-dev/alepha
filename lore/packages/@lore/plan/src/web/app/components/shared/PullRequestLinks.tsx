import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";

import type { PullRequest } from "../../../../api/schemas/pullRequestSchema.ts";

export interface PullRequestLinksProps {
  pullRequests: Array<Pick<PullRequest, "url" | "number" | "title">>;
  /**
   * `end` in the quest rail, whose values are right-aligned; `start` on the
   * epic page's aside, whose are not.
   */
  align?: "start" | "end";
}

/**
 * A quest's or an epic's pull requests, each linked by the URL it was
 * recorded with (#Q3707): the quest rail and the epic page draw the same
 * list from the same component, so the two cannot drift on the label or on
 * what an unlinkable entry looks like.
 *
 * `#118` when the number was recorded, the URL without its scheme when it
 * was not. The title is a tooltip, as a commit's message is on the rail: the
 * column is narrow and the number is the identifier.
 *
 * The URL was checked to be http or https when it was written; it is checked
 * again here, so a row that somehow is not renders as text rather than an
 * `href` nothing vetted.
 */
const PullRequestLinks = (props: PullRequestLinksProps) => (
  <span
    className={`flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 ${props.align === "start" ? "justify-start" : "justify-end"}`}
  >
    {props.pullRequests.map((pr) => {
      const label = pr.number
        ? `#${pr.number}`
        : pr.url.replace(/^https?:\/\//i, "");
      const link = /^https?:\/\//i.test(pr.url) ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-full truncate underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {label}
        </a>
      ) : (
        <span className="max-w-full truncate">{label}</span>
      );

      if (!pr.title) {
        return (
          <span key={pr.url} className="min-w-0">
            {link}
          </span>
        );
      }

      return (
        <Tooltip key={pr.url}>
          <TooltipTrigger render={<span className="min-w-0">{link}</span>} />
          <TooltipContent className="max-w-xs text-left">
            {pr.title}
          </TooltipContent>
        </Tooltip>
      );
    })}
  </span>
);

export default PullRequestLinks;
