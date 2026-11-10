// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * URL for a publicly-served file — the anonymous, edge-cacheable route
 * (`GET /api/public/files/:id`, `Cache-Control: public, immutable`).
 *
 * Use this ONLY for buckets the server opts into via
 * `LoreFileAccessProvider.assertPublic` — today that's user **avatars**
 * (`user.picture`) and **project icons** (`project.icon`). Member- or
 * owner-gated files (quest attachments, feedback attachments, folio
 * attachments) must keep the authenticated `/api/files/:id` route.
 */
export const publicFileUrl = (fileId: string): string =>
  `/api/public/files/${fileId}`;
