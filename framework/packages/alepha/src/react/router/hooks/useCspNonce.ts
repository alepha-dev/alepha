import { useAlepha } from "alepha/react";

/**
 * The CSP nonce of the page being rendered on the server.
 *
 * For a component that writes an inline `<script>` of its own: a library's
 * pre-hydration script, through that library's CSP provider.
 *
 * `undefined` in the browser, where the script has already run from the
 * server's HTML, and on any render with no nonce: the CSP off, a page cache
 * hit, a prerender. A page whose markup carries the nonce is never stored by
 * the page cache, so prefer a hash for a script whose content is constant.
 *
 * @example
 * ```tsx
 * import { CSPProvider } from "@base-ui/react/csp-provider";
 *
 * const Widget = () => (
 *   <CSPProvider nonce={useCspNonce()}>{...}</CSPProvider>
 * );
 * ```
 */
export const useCspNonce = (): string | undefined => {
  const alepha = useAlepha();
  if (alepha.isBrowser()) {
    return undefined;
  }
  return alepha.store.getUntracked("alepha.react.router.nonce");
};
