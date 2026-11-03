import { useAlepha, useInject } from "alepha/react";
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
        dangerouslySetInnerHTML={{ __html: "" }}
      />
    );
  }

  use(deferred.settled(props.promise) as Promise<unknown>);

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: deferred.deliveryScript(props.id, props.promise),
      }}
    />
  );
};

export default DeferredScript;
