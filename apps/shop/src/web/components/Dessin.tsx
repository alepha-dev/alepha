export interface DessinProps {
  /** File id from `alepha/api/files`, or an absolute URL. */
  image?: string;
  /** Alt text — the piece's name. */
  nom: string;
  className?: string;
  /** Load eagerly for the piece a page is about; lazily for a catalogue row. */
  priority?: boolean;
}

/**
 * A piece's technical drawing.
 *
 * Served from `alepha/api/files` — the product stores a file id, not a path, so
 * the same markup works whether the deployment keeps blobs on disk, in R2 or S3.
 *
 * The URL is `/api/public/files/{id}`, not `/public/files/{id}`: the file
 * controller declares its route with `$action`, and `$action` mounts under
 * `/api`. Getting that wrong fails silently — the SPA catch-all answers with the
 * app's own HTML, so the browser reports a broken image and never a 404.
 *
 * No frame, no shadow, no rounded corner: a drawing on paper has none of those,
 * and adding them would make it look like a product card instead of a drawing.
 */
export const Dessin = (props: DessinProps) => {
  const { image, nom, className, priority } = props;

  if (!image) {
    // An unillustrated piece still needs to occupy its place in the rhythm, so
    // the space is held rather than collapsed.
    return (
      <div
        className={`bg-muted/40 aspect-[5/6] ${className ?? ""}`}
        aria-hidden="true"
      />
    );
  }

  const src = image.startsWith("http") ? image : `/api/public/files/${image}`;

  return (
    <img
      src={src}
      alt={`${nom}, dessin d'atelier`}
      className={`dessin ${className ?? ""}`}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
};
