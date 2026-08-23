import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { cn } from "@alepha/ui/lib/utils";
import { User } from "lucide-react";

export interface UserAvatarProps {
  /**
   * User avatar file id (`user.picture`). Absent → a `User` placeholder.
   */
  fileId?: string | null;
  /**
   * Container classes — size/shape overrides (defaults to `size-8`).
   */
  className?: string;
  alt?: string;
}

/**
 * Round user avatar. Serves `user.picture` from the public, edge-cacheable
 * file route via {@link FileImage}, with a centered `User` icon when the
 * picture is missing or fails to load.
 */
export const UserAvatar = (props: UserAvatarProps) => (
  <div
    className={cn(
      "bg-muted text-muted-foreground flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-full",
      props.className ?? "size-8",
    )}
  >
    <FileImage
      id={props.fileId}
      public
      alt={props.alt ?? ""}
      className="size-full object-cover"
      fallback={<User className="h-1/2 w-1/2" />}
    />
  </div>
);
