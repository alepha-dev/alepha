import { type ComponentProps, type ReactNode, useState } from "react";

export interface FileImageProps extends Omit<
  ComponentProps<"img">,
  "src" | "id"
> {
  /**
   * File id (uuid) served by the Alepha files module. Absent → renders
   * `fallback`. (Repurposes the `id` slot — the raw HTML `id` attribute
   * isn't forwarded.)
   */
  id?: string | null;
  /**
   * Serve via the anonymous, edge-cacheable `/api/public/files/:id` route
   * instead of the authenticated `/api/files/:id`. Only valid for files the
   * server opts into (`FileAccessProvider.assertPublic`). Default:
   * authenticated.
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
 */
export const FileImage = (props: FileImageProps) => {
  const { id, public: isPublic, fallback = null, ...imgProps } = props;
  // Track the id that failed so a later id change re-attempts the load.
  const [erroredId, setErroredId] = useState<string | null>(null);

  if (!id || erroredId === id) {
    return <>{fallback}</>;
  }

  const src = isPublic ? `/api/public/files/${id}` : `/api/files/${id}`;
  return (
    <img
      alt=""
      src={src}
      loading="lazy"
      onError={() => setErroredId(id)}
      {...imgProps}
    />
  );
};
