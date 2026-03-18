import { Alepha } from "alepha";
import { useInject } from "alepha/react";
import { useCallback, useEffect, useMemo } from "react";
import type { Head } from "../interfaces/Head.ts";
import { BrowserHeadProvider } from "../providers/BrowserHeadProvider.ts";

/**
 * ```tsx
 * const App = () => {
 *   const [head, setHead] = useHead({
 *     // will set the document title on the first render
 *     title: "My App",
 *   });
 *
 *   return (
 *     // This will update the document title when the button is clicked
 *     <button onClick={() => setHead({ title: "Change Title" })}>
 *       Change Title {head.title}
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
    headProvider.renderHead(window.document, resolved);
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
