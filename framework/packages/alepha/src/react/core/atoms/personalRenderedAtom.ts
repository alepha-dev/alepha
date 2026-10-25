import { $atom, z } from "alepha";

/**
 * Whether the server rendered `<Personal>`'s children for this request,
 * rather than their fallback.
 *
 * Personal, so it travels in `__ssr_private` and is rebuilt for every
 * request: a page served from the page cache never carries it, and its
 * browser hydrates the fallback the cached HTML holds (#E78).
 */
export const personalRenderedAtom = $atom({
  name: "alepha.react.personal.rendered",
  schema: z.boolean(),
  default: false,
  personal: true,
});
