import { BrandIcon } from "@alepha/ui";
import { GitBranch } from "lucide-react";

import { ProjectIcon } from "../shared/ProjectIcon.tsx";

export interface ProjectRailCardProps {
  project: {
    title: string;
    slug: string;
    icon?: string | null;
    repositoryUrl?: string | null;
  };
}

/**
 * What the project rail shows on hover (#Q3370): the project's image, its
 * name, and its repository when one is set.
 *
 * The repository line follows `HeaderRepositoryButton`'s rules: the GitHub
 * mark only for a GitHub host, a neutral branch icon for any other, and no
 * line at all for a stored value that does not parse as a URL. It shows the
 * path (`owner/repo`) rather than the whole URL, which the card is too narrow
 * for and which says nothing more.
 */
export const ProjectRailCard = (props: ProjectRailCardProps) => {
  const repository = parseRepository(props.project.repositoryUrl);
  return (
    <div className="flex items-center gap-3" data-testid="project-rail-card">
      <ProjectIcon
        fileId={props.project.icon}
        title={props.project.title}
        seed={props.project.slug}
        className="size-12 rounded-xl"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-semibold">{props.project.title}</span>
        {repository && (
          <a
            href={repository.url}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="project-rail-card-repository"
            className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1.5 text-xs"
          >
            {repository.github ? (
              <BrandIcon provider="github" className="size-3.5 shrink-0" />
            ) : (
              <GitBranch className="size-3.5 shrink-0" />
            )}
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
  // Endswith rather than includes, so `github.com.example.org` is not GitHub.
  const github = host === "github.com" || host.endsWith(".github.com");
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return { url, github, label: path || host };
};
