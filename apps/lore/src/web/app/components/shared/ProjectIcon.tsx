import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { cn } from "@alepha/ui/lib/utils";
import { Image as ImageIcon } from "lucide-react";

export interface ProjectIconProps {
  /** Project icon file id (`project.icon`). Absent → an image placeholder. */
  fileId?: string | null;
  /** Container classes — size/shape overrides (defaults to `size-8`). */
  className?: string;
  alt?: string;
}

/**
 * Square project logo. Serves `project.icon` from the public,
 * edge-cacheable file route via {@link FileImage}, with a centered image
 * placeholder when the icon is missing or fails to load.
 */
export const ProjectIcon = (props: ProjectIconProps) => (
  <div
    className={cn(
      "bg-muted text-muted-foreground flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-md",
      props.className ?? "size-8",
    )}
  >
    <FileImage
      id={props.fileId}
      public
      alt={props.alt ?? ""}
      className="size-full object-cover"
      fallback={<ImageIcon className="h-1/2 w-1/2" />}
    />
  </div>
);
