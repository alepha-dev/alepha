import { FileImage, cn } from "@alepha/ui";
import { Image as ImageIcon } from "lucide-react";

import { projectInitials, projectMonogramColor } from "./projectMonogram.ts";

export interface ProjectIconProps {
  /**
   * Project icon file id (`project.icon`). Absent: the monogram when `title`
   * is given, an image placeholder otherwise.
   */
  fileId?: string | null;
  /**
   * The project's title. Without an icon, its two initials are drawn on a
   * coloured tile instead of the grey image placeholder (#Q3366).
   */
  title?: string;
  /**
   * What the monogram's colour is hashed from: the project's slug. Defaults
   * to `title`.
   */
  seed?: string;
  /**
   * Container classes: size and shape overrides (defaults to `size-8`).
   */
  className?: string;
  alt?: string;
}

/**
 * Square project logo. Serves `project.icon` from the public,
 * edge-cacheable file route via {@link FileImage}. When the icon is missing
 * or fails to load, it draws the project's initials on a colour of its own,
 * or a centered image placeholder for a caller that passes no `title`.
 *
 * The container is a CSS size container, so the initials scale with whatever
 * size the caller gives the icon.
 */
export const ProjectIcon = (props: ProjectIconProps) => (
  <div
    className={cn(
      "bg-muted text-muted-foreground @container flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-md",
      props.className ?? "size-8",
    )}
  >
    <FileImage
      id={props.fileId}
      public
      alt={props.alt ?? ""}
      className="size-full object-cover"
      fallback={
        props.title ? (
          <span
            aria-hidden
            data-testid="project-monogram"
            className={cn(
              "flex size-full items-center justify-center text-[40cqw] leading-none font-semibold tracking-tight select-none",
              projectMonogramColor(props.seed ?? props.title),
            )}
          >
            {projectInitials(props.title)}
          </span>
        ) : (
          <ImageIcon className="h-1/2 w-1/2" />
        )
      }
    />
  </div>
);
