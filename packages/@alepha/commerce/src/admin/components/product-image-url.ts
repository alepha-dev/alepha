/**
 * Resolve a `products.images` entry to something an `<img src>` can load.
 *
 * That column holds either a file id from `alepha/api/files` or an absolute
 * URL — deliberately, so a shop serving its photographs from a CDN carries no
 * file rows at all (see the note on `products.images`). Both shapes therefore
 * reach the UI, and only the id needs a route.
 *
 * `/api/public/files/:id` rather than the authenticated `/api/files/:id`: a
 * catalogue image is by definition public, and the anonymous route is
 * edge-cacheable. It is the same resolution `apps/example-shop` does on its storefront.
 */
export const productImageUrl = (ref?: string): string | undefined => {
  if (!ref) return undefined;
  return ref.startsWith("http") ? ref : `/api/public/files/${ref}`;
};
