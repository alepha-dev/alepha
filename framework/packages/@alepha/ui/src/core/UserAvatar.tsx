import { AlephaContext } from "alepha/react";
import { User } from "lucide-react";
import { type ReactNode, useContext } from "react";

import { FileImage } from "./FileImage.tsx";
import {
  type UserAvatarUser,
  userAvatarTone,
  userDisplayName,
  userInitials,
} from "./userInitials.ts";
import { cn } from "./utils.ts";

export interface UserAvatarProps {
  /**
   * The user the avatar is for. Without a picture to show, it draws their
   * two initials on a colour of their own; `fileId` defaults to its
   * `picture`.
   */
  user?: UserAvatarUser;

  /**
   * The user's picture (`user.picture`): a file id in the `avatars` bucket,
   * or an absolute `http(s)` URL, which is drawn as-is (see
   * {@link FileImage}). Defaults to `user.picture`; `null` draws no picture
   * even when the user has one, which is how a caller says the app does not
   * use pictures. Absent → the fallback.
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
   * Ignored for a URL picture, which never goes through either route.
   *
   * @default false
   */
  public?: boolean;

  /**
   * Drawn when there is no picture, or when it fails to load (deleted,
   * forbidden, a closed public route), in place of the initials. Defaults to
   * the user's initials, else a centred `User` glyph.
   */
  fallback?: ReactNode;
}

/**
 * Round user avatar for a `user.picture` (a file id, or an absolute URL),
 * drawn through {@link FileImage}, and the user's two initials on a colour
 * of their own whenever there is no picture to show: avatars off, a user who
 * never set one, or a picture that fails to load. The fallback costs no
 * request: with no picture `FileImage` never calls `/api/files`.
 *
 * The initials are the first letters of the first and last names, one
 * name's first two, else the username's or the email's first two, split by
 * grapheme and uppercased in the viewer's language; the colour comes from a
 * hash of `user.id`, so a rename keeps it. The circle is an image named
 * after the user (`alt`, else their name), and the letters are hidden from
 * a screen reader, which says the name rather than "J D".
 *
 * **When the app does not use pictures** (`$realm({ features: { avatars:
 * false } })`), the caller passes `fileId={null}`: a picture URL an OIDC
 * provider filled in, or a file id left from before avatars were switched
 * off, is then never fetched, and everyone gets the initials. The kit cannot
 * tell on its own whether the feature is on, so the caller that can (an
 * action's `can()`) decides.
 *
 * It lives in the kit rather than in an application because nothing about
 * it is an application's: `FileImage` is a kit component, both file routes
 * belong to `alepha/api/files`, and the `avatars` bucket is declared by
 * `alepha/api/users`.
 */
export const UserAvatar = (props: UserAvatarProps) => {
  // The viewer's language, from the key `useI18n` reads, read without a hook
  // that needs a container or the i18n module: an avatar draws anywhere,
  // even outside an Alepha tree. It only casts the initials (`i` is `İ` in
  // Turkish), so a stale read until the next render costs nothing.
  const lang = useContext(AlephaContext)?.store.get(
    "alepha.react.i18n.lang",
  ) as string | undefined;
  const user = props.user;
  const fileId = props.fileId !== undefined ? props.fileId : user?.picture;
  const initials = user ? userInitials(user, lang) : "";
  const label = props.alt ?? (user ? userDisplayName(user) : "");
  const fallback =
    props.fallback ??
    (initials ? (
      <span
        aria-hidden="true"
        className="text-[40cqw] leading-none font-semibold select-none"
      >
        {initials}
      </span>
    ) : (
      <User className="h-1/2 w-1/2" aria-hidden="true" />
    ));

  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      className={cn(
        "@container flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-full",
        user ? userAvatarTone(user.id) : "bg-muted text-muted-foreground",
        props.className ?? "size-8",
      )}
    >
      <FileImage
        id={fileId}
        public={props.public}
        alt=""
        className="size-full object-cover"
        fallback={fallback}
      />
    </div>
  );
};
