import { Alepha } from "alepha";
import { useInject } from "alepha/react";
import { useCallback, useEffect, useMemo } from "react";

import { SeoExpander } from "../helpers/SeoExpander.ts";
import type { Head } from "../interfaces/Head.ts";
import { BrowserHeadProvider } from "../providers/BrowserHeadProvider.ts";

/**
 * Read and update the document head (title, meta, …) from a component.
 *
 * The SEO fields (`description`, `image`, `url`, ...) expand into their meta
 * and link tags, as in a page's `head`. The returned head reads the document
 * when asked: it is not state, and `setHead` does not render the component
 * again.
 *
 * ```tsx
 * const App = () => {
 *   const [, setHead] = useHead({
 *     // will set the document title on the first render
 *     title: "My App",
 *   });
 *
 *   return (
 *     // This will update the document title when the button is clicked
 *     <button onClick={() => setHead({ title: "Change Title" })}>
 *       Change Title
 *     </button>
 *   );
 * }
 * ```
 */
export const useHead = (options?: UseHeadOptions): UseHeadReturn => {
  const alepha = useInject(Alepha);

  const current = useMemo(() => {
    if (!alepha.isBrowser()) {
      return {};
    }

    return alepha.inject(BrowserHeadProvider).getHead(window.document);
  }, []);

  const setHead = useCallback((head?: Head | ((previous?: Head) => Head)) => {
    if (!alepha.isBrowser()) {
      return;
    }

    const headProvider = alepha.inject(BrowserHeadProvider);
    const resolved =
      typeof head === "function"
        ? head(headProvider.getHead(window.document))
        : head || {};
    // Expanded here: `renderHead` writes tags and reads no SEO field, so
    // `setHead({ description })` changed nothing, silently.
    const { meta, link } = alepha.inject(SeoExpander).expand(resolved);
    headProvider.renderHead(window.document, {
      ...resolved,
      meta: [...meta, ...(resolved.meta ?? [])],
      link: [...link, ...(resolved.link ?? [])],
    });
  }, []);

  useEffect(() => {
    if (options) {
      setHead(options);
    }
  }, []);

  return [current, setHead];
};

export type UseHeadOptions = Head | ((previous?: Head) => Head);

export type UseHeadReturn = [
  Head,
  (head?: Head | ((previous?: Head) => Head)) => void,
];
