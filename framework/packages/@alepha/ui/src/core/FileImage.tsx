import { type ComponentProps, type ReactNode, useState } from "react";

export interface FileImageProps extends Omit<
  ComponentProps<"img">,
  "src" | "id"
> {
  /**
   * File id (uuid) served by the Alepha files module, or an absolute
   * `http(s)` URL drawn as-is. Absent → renders `fallback`. (Repurposes the
   * `id` slot — the raw HTML `id` attribute isn't forwarded.)
   *
   * A URL is accepted because `user.picture` is one in three cases the
   * framework itself allows: an account created before OAuth sign-up
   * imported the provider's picture into the `avatars` bucket, a picture
   * passed to the register endpoint, and a user from an external issuer,
   * whose `picture` claim is a URL by the OpenID Connect spec. Building
   * `/api/files/https://…` from one of those is a request that can only 404.
   */
  id?: string | null;
  /**
   * Serve via the anonymous, edge-cacheable `/api/public/files/:id` route
   * instead of the authenticated `/api/files/:id`. Only valid for files the
   * server opts into (`FileAccessProvider.assertPublic`). Default:
   * authenticated. Ignored for an absolute URL.
   */
  public?: boolean;
  /**
   * Rendered when `id` is missing OR the image fails to load (deleted, 404,
   * forbidden) — a placeholder icon/initials instead of a broken-image glyph.
   */
  fallback?: ReactNode;
}

/**
 * `<img>` for a file served by the Alepha files module, addressed by uuid.
 *
 * Resolves the src from `id` (`public` picks the anonymous edge-cacheable
 * route vs the authenticated one), lazy-loads, and renders `fallback` when
 * the id is missing or the image fails to load — so a deleted/forbidden
 * file shows a placeholder instead of a broken-image glyph.
 *
 * An absolute `http(s)` URL is drawn from where it points, with no referrer,
 * so the third party serving it learns the viewer's address but not which
 * page they were on.
 */
export const FileImage = (props: FileImageProps) => {
  const { id, public: isPublic, fallback = null, ...imgProps } = props;
  // Track the id that failed so a later id change re-attempts the load.
  const [erroredId, setErroredId] = useState<string | null>(null);

  if (!id || erroredId === id) {
    return <>{fallback}</>;
  }

  const external = /^https?:\/\//i.test(id);
  const src = external
    ? id
    : isPublic
      ? `/api/public/files/${id}`
      : `/api/files/${id}`;
  return (
    <img
      alt=""
      src={src}
      loading="lazy"
      referrerPolicy={external ? "no-referrer" : undefined}
      onError={() => setErroredId(id)}
      {...imgProps}
    />
  );
};
