/**
 * Where "the app came back" comes from, for `QueryCache`'s refetches.
 *
 * In the browser: `visibilitychange` to visible, and `online`. The window's
 * `focus` event is not used: it also fires on a click back from the devtools
 * or from an iframe, which is not the reader returning.
 *
 * A native shell substitutes this class to listen to its own resume and
 * network events instead:
 *
 * ```ts
 * class NativeWakeEvents extends QueryWakeEvents {
 *   protected listen(handlers: QueryWakeHandlers): () => void {
 *     const a = App.addListener("resume", handlers.visible);
 *     const b = Network.addListener("online", handlers.online);
 *     return () => { a.remove(); b.remove(); };
 *   }
 * }
 * ```
 */
export class QueryWakeEvents {
  protected unlisten?: () => void;

  /**
   * Start listening, once: a second call while listening does nothing.
   */
  public start(handlers: QueryWakeHandlers): void {
    if (this.unlisten || !this.available()) {
      return;
    }
    this.unlisten = this.listen(handlers);
  }

  /**
   * Stop listening. Safe to call when not listening.
   */
  public stop(): void {
    this.unlisten?.();
    this.unlisten = undefined;
  }

  /**
   * Whether `start` adds its listeners: in the browser only.
   */
  public listening(): boolean {
    return this.unlisten !== undefined;
  }

  protected available(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
  }

  /**
   * Add the listeners and return what removes them.
   */
  protected listen(handlers: QueryWakeHandlers): () => void {
    const onVisibility = () => {
      if (!document.hidden) {
        handlers.visible();
      }
    };
    const onOnline = () => handlers.online();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }
}

/**
 * What {@link QueryWakeEvents} calls.
 */
export interface QueryWakeHandlers {
  /**
   * The page became visible again.
   */
  visible: () => void;

  /**
   * The network came back.
   */
  online: () => void;
}
