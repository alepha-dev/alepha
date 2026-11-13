import { cn } from "@alepha/ui";
import type { ReactNode } from "react";

import { ProjectIcon } from "../shared/ProjectIcon.tsx";

export interface ProjectRailCardProps {
  project: {
    title: string;
    slug: string;
    icon?: string | null;
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
 * What the project rail shows on hover (#Q3370): the project's image and its
 * name.
 *
 * Account > Projects draws each row with it too (#Q3411), and the project
 * sidebar its header (#Q3420), both `compact`, so the three show a project
 * the same way.
 */
export const ProjectRailCard = (props: ProjectRailCardProps) => {
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
      </div>
    </div>
  );
};
