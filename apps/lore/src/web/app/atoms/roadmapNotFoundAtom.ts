import { $atom, z } from "alepha";

/**
 * Set by the `projectRoadmap` loader when the roadmap it asked for does not
 * exist or is not visible, and read by that route's `onServerResponse` so the
 * page answers a real **404** instead of a 200 carrying an error.
 *
 * ⚠️ **This exists because a soft 404 on a crawlable page is worse than no
 * 404 page at all.** `/:projectSlug/roadmap` matches ANY root segment, so
 * without it every misspelled slug and every project with the roadmap off
 * would serve a 200 that a crawler indexes as a real page - an unbounded
 * surface of them. None of Lore's other pages have this problem, because
 * every one of them sits behind `$secure()` and no crawler ever reaches it.
 *
 * A one-way channel from the loader to the response, and the only mechanism
 * available: `onServerResponse` receives the `ServerRequest` and nothing
 * about what the loader found, and a page loader has no access to `reply`.
 * The framework's `stream: false` note documents this shape - buffer the
 * render so the status is still open when the loader is done - without
 * saying how the two halves talk; the request-scoped store is how.
 *
 * `serverOnly` because it is exactly that: internal request state, with no
 * business reaching the hydration payload. Request-scoped by construction, so
 * one visitor's 404 can never stamp itself on another's response.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const roadmapNotFoundAtom = $atom({
  name: "lor.roadmap.not_found",
  schema: z.object({
    missing: z.boolean(),
  }),
  // The safe answer, and the one every request starts from: a page that
  // rendered is a page that exists.
  default: { missing: false },
  serverOnly: true,
});
