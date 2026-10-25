/**
 * The renderer half of React, loaded only once something actually renders.
 *
 * `react-dom/server` is ~196KB minified - on workerd that is ~12% of the
 * bytes parsed before a handler runs, and it was being parsed on every cold
 * start regardless of what the request wanted. Most invocations of a typical
 * Alepha app render no HTML at all: they answer an API route, a webhook or a
 * telemetry POST. Those paid for the renderer and never called it.
 *
 * Loading it through this provider keeps it out of the eager module graph, so
 * it becomes an async chunk the runtime fetches on the first render and never
 * again. `react` itself (~8KB) stays eagerly imported, which is what it should
 * be - every component module needs `jsx` and the hooks.
 *
 * ⚠️ **A static `import … from "react-dom/server"` anywhere in the server graph
 * undoes this completely.** One eager edge pulls the whole module back onto the
 * cold-start path and nothing about this provider will report that it happened.
 * `REACT_SSR_ENABLED=false` does not help either: it is read at runtime, long
 * after the module graph has been decided.
 */
export class ReactDomServerProvider {
  /**
   * The resolved module, once loaded. Also the synchronous read for
   * {@link peek}.
   */
  protected module?: typeof import("react-dom/server");

  /**
   * The in-flight load, so concurrent first renders share one import rather
   * than racing to assign {@link module}.
   */
  protected pending?: Promise<typeof import("react-dom/server")>;

  /**
   * Load the renderer, reusing it on every subsequent call.
   *
   * Call this from the render path, which is async anyway — the first call
   * pays for fetching the chunk and later ones resolve from cache.
   */
  public async load(): Promise<typeof import("react-dom/server")> {
    if (this.module) {
      return this.module;
    }
    this.pending ??= import("react-dom/server");
    this.module = await this.pending;
    return this.module;
  }

  /**
   * The renderer if it is already loaded, without awaiting.
   *
   * For the error paths inside the streaming renderer, which run as
   * `ReadableStream` controller callbacks and so cannot await. They do not need
   * to: an SSR error can only happen once a render is under way, and a render
   * begins by awaiting {@link load}. So by the time any of them runs, this
   * returns the module.
   *
   * It is still an `undefined`-returning accessor rather than an assertion,
   * because the cost of being wrong is a throw inside a stream controller —
   * which surfaces as a truncated response rather than as the error the page
   * was trying to report. Callers fall back to plain text instead.
   */
  public peek(): typeof import("react-dom/server") | undefined {
    return this.module;
  }
}
