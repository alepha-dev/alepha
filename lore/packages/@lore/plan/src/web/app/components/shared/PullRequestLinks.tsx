import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import type { PullRequestController } from "@lore/core/api";
import { currentProjectAtom } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useState } from "react";

import type { PullRequest } from "../../../../api/schemas/pullRequestSchema.ts";
import PullRequestStateChip from "./PullRequestStateChip.tsx";

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
 *
 * For a project connected to GitHub, each one shows its state and checks
 * (#Q4367), read from Lore's own rows and refreshed every 30 s while one
 * shown is open (the poll stops itself, and pauses on a hidden tab).
 */
const PullRequestLinks = (props: PullRequestLinksProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<PullRequestController>();
  const urls = props.pullRequests.map((pr) => pr.url);
  const [live, setLive] = useState(false);
  const states = useQuery(
    {
      key: ["pull-request-states", project?.id, urls.join(" ")],
      handler: async () => {
        const answer = await api.getPullRequestStates({
          params: { projectId: project!.id },
          body: { urls: urls.slice(0, 50) },
        });
        setLive(
          answer.items.some(
            (state) => state.state === "open" || state.state === "draft",
          ),
        );
        return answer;
      },
      enabled: project !== undefined && urls.length > 0,
      // Set only while a shown pull request can still move.
      runEvery: live ? 30_000 : undefined,
      onError: () => {},
    },
    // `runEvery` is read on each render, so `live` stays out of the deps.
    [api, project?.id, urls.join(" ")],
  );
  const byUrl = new Map(
    (states.data?.items ?? []).map((state) => [state.url, state]),
  );
  return (
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
            className={cn(
              textLinkUnderlineClassName,
              "hover:text-foreground max-w-full truncate",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            {label}
          </a>
        ) : (
          <span className="max-w-full truncate">{label}</span>
        );

        const state = byUrl.get(pr.url);
        const linked = state ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            {link}
            <PullRequestStateChip state={state} />
          </span>
        ) : (
          link
        );

        if (!pr.title) {
          return (
            <span key={pr.url} className="min-w-0">
              {linked}
            </span>
          );
        }

        return (
          <Tooltip key={pr.url}>
            <TooltipTrigger
              render={<span className="min-w-0">{linked}</span>}
            />
            <TooltipContent className="max-w-xs text-left">
              {pr.title}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
};

export default PullRequestLinks;
