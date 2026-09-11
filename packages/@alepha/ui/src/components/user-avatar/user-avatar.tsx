import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { cn } from "@alepha/ui/lib/utils";
import { User } from "lucide-react";
import type { ReactNode } from "react";

export interface UserAvatarProps {
  /**
   * The user's avatar file id (`user.picture`). Absent → the fallback.
   */
  fileId?: string | null;

  /**
   * Container classes - size and shape overrides (defaults to `size-8`).
   */
  className?: string;

  alt?: string;

  /**
   * Serve the picture through the anonymous, edge-cacheable
   * `/api/public/files/:id` instead of the authenticated `/api/files/:id`.
   *
   * ⚠️ **Only where the application opened the bucket.** The default
   * `FileAccessProvider.assertPublic` refuses every public read, so under it
   * a public avatar never loads and the fallback is all anyone sees. The
   * authenticated route needs no opt-in for the uploader or an admin, which
   * is why it is the default.
   *
   * Worth turning on where MANY viewers load the same avatars (a member
   * list, an assignee picker): that is what an edge cache shares. The
   * viewer's own avatar gains nothing from it, since the authenticated
   * response is already `private, max-age=1y, immutable` in the browser.
   *
   * @default false
   */
  public?: boolean;

  /**
   * Drawn when there is no picture, or when it fails to load (deleted,
   * forbidden, a closed public route). Defaults to a centred `User` glyph;
   * a list that identifies people by letter passes the initial instead.
   */
  fallback?: ReactNode;
}

/**
 * Round user avatar for a `user.picture` file id, drawn through
 * {@link FileImage}, with a fallback when the picture is missing or fails to
 * load.
 *
 * It lives in the kit rather than in an application because nothing about
 * it is an application's: `FileImage` is a kit component, both file routes
 * belong to `alepha/api/files`, and the `avatars` bucket is declared by
 * `alepha/api/users`. It moved here from Lore with #Q2229, so the account
 * button of every `@alepha/ui` shell can draw the viewer's face.
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
      public={props.public}
      alt={props.alt ?? ""}
      className="size-full object-cover"
      fallback={props.fallback ?? <User className="h-1/2 w-1/2" />}
    />
  </div>
);
