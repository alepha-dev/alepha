import { cn } from "@alepha/ui";
import type { ReactNode } from "react";

import { ProjectIcon } from "../shared/ProjectIcon.tsx";

export interface ProjectRailCardProps {
  project: {
    title: string;
    slug: string;
    icon?: string | null;
    repositoryUrl?: string | null;
  };
  /**
   * A row's size rather than a card's: a smaller image, one line of title
   * (Account > Projects, #Q3411).
   */
  compact?: boolean;
  /**
   * Replaces the plain title, for a caller that makes it a link.
   */
  title?: ReactNode;
  /**
   * Drawn after the title (an Archived badge).
   */
  badge?: ReactNode;
}

/**
 * What the project rail shows on hover (#Q3370): the project's image, its
 * name, and its repository when one is set.
 *
 * The repository line is the path (`owner/repo`) alone, with no icon
 * (#Q3482): rather than the whole URL, which the card is too narrow for and
 * which says nothing more, and no line at all for a stored value that does
 * not parse as a URL. The host, which the path does not say, is in the
 * link's label and its tooltip.
 *
 * Account > Projects draws each row with it too (#Q3411), and the project
 * sidebar its header (#Q3420), both `compact`, so the three show a project
 * the same way.
 */
export const ProjectRailCard = (props: ProjectRailCardProps) => {
  const repository = parseRepository(props.project.repositoryUrl);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        props.compact ? "gap-2.5" : "gap-3",
      )}
      data-testid="project-rail-card"
    >
      <ProjectIcon
        fileId={props.project.icon}
        title={props.project.title}
        seed={props.project.slug}
        className={cn(
          "shrink-0",
          props.compact ? "size-8 rounded-lg" : "size-12 rounded-xl",
        )}
      />
      <div
        className={cn(
          "flex min-w-0 flex-col",
          props.compact ? "gap-0.5" : "gap-1",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate",
              props.compact ? "text-sm font-medium" : "font-semibold",
            )}
          >
            {props.title ?? props.project.title}
          </span>
          {props.badge}
        </span>
        {repository && (
          <a
            href={repository.url}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="project-rail-card-repository"
            // The host is the part of the destination the path does not say.
            aria-label={`${repository.label} (${repository.host})`}
            // Never the row's own click, where a caller's row navigates.
            onClick={(event) => event.stopPropagation()}
            title={repository.host}
            className="text-muted-foreground hover:text-foreground flex min-w-0 items-center text-xs"
          >
            <span className="truncate">{repository.label}</span>
          </a>
        )}
      </div>
    </div>
  );
};

const parseRepository = (url?: string | null) => {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.host;
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return { url, host, label: path || host };
};
