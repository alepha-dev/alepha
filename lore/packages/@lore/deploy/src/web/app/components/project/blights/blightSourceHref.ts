/**
 * The address a blight's `sourceUrl` may be opened at, or `undefined` when it
 * must stay text.
 *
 * The value takes three shapes (feedback #P2200): a full page URL from the
 * browser sigil, a route pattern from the server one
 * (`/api/projects/:projectId/...`), and a job name (`job:lore.deploy.run`).
 * Only the first names a place.
 *
 * ⚠️ `sourceUrl` is reporter-controlled telemetry, so the scheme is checked on
 * the PARSED URL and only `http:` and `https:` pass: a `javascript:` or
 * `data:` value rendered as an `href` is script the owner runs by clicking.
 * `job:lore.deploy.run` parses as a URL too, with the scheme `job:`, which is
 * the other reason a parse alone is not the test.
 */
export const blightSourceHref = (sourceUrl: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.href
    : undefined;
};
