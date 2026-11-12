import { TrustedTypes, useAlepha, useInject } from "alepha/react";
import { use } from "react";

import {
  type DeferredPromise,
  ReactDeferred,
} from "../services/ReactDeferred.ts";

export interface DeferredScriptProps {
  id: string;
  promise: DeferredPromise;
}

/**
 * Delivers a deferred value to the browser, as an inline script, once it has
 * settled.
 *
 * Rendered by React rather than written beside its stream, inside a
 * `<Suspense>` of its own: Fizz then decides when the bytes are safe to write,
 * holds the document open until the value is out, even a value no component
 * read, and never cuts a tag in half.
 *
 * In the browser it renders the same element for hydration to match, and does
 * not wait: the script has already run, or will when it reaches the parser.
 */
const DeferredScript = (props: DeferredScriptProps) => {
  const alepha = useAlepha();
  const deferred = useInject(ReactDeferred);

  // `dangerouslySetInnerHTML` even when empty: without it the server's text is
  // a child hydration did not expect, which no warning suppression excuses.
  if (alepha.isBrowser()) {
    return (
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: TrustedTypes.html("") }}
      />
    );
  }

  // A buffered render (`stream: false`, a prerender, a client-rendered page)
  // ships every value settled in the payload: a delivery script there would
  // be dead weight, and under a CSP a violation nobody could fix on a
  // prerendered file. The empty element still matches the browser's, and an
  // empty inline script is never checked against the policy.
  if (!alepha.store.getUntracked("alepha.react.router.streamed")) {
    return <script dangerouslySetInnerHTML={{ __html: "" }} />;
  }

  use(deferred.settled(props.promise) as Promise<unknown>);

  return (
    <script
      nonce={alepha.store.getUntracked("alepha.react.router.nonce")}
      dangerouslySetInnerHTML={{
        __html: deferred.deliveryScript(props.id, props.promise),
      }}
    />
  );
};

export default DeferredScript;
