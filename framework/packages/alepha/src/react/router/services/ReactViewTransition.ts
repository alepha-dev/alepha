import type { PageViewTransition } from "../primitives/$page.ts";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";

/**
 * What a page's `viewTransition` asks for, on a given navigation.
 *
 * Every value is a CSS class name React sets as `view-transition-class`.
 * An absent value is React's `none`.
 */
export interface ViewTransitionClasses {
  enter?: string;
  exit?: string;
  update?: string;
}

/**
 * Turns a page's `viewTransition` option into the classes of one navigation.
 *
 * A service rather than a helper of `NestedView`, because the browser provider
 * is the one that hears `popstate` while the views are the ones that read the
 * answer, and a view cannot inject the browser provider: `NestedView` renders
 * on the server too.
 */
export class ReactViewTransition {
  /**
   * The browser already animated this navigation itself, an iOS swipe back.
   * Set on `popstate` from `hasUAVisualTransition`, cleared on a push.
   */
  public browserAnimated = false;

  protected get prefersReducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    );
  }

  /**
   * The classes `option` gives the navigation to `target`.
   *
   * A string is the page's enter and exit, never its update: an update is any
   * change inside a page that stays, a query filter included.
   */
  public resolve(
    option: PageViewTransition | undefined,
    target: ReactRouterState,
  ): ViewTransitionClasses {
    if (!option || this.browserAnimated || this.prefersReducedMotion) {
      return {};
    }

    const resolved = typeof option === "function" ? option(target) : option;

    if (typeof resolved === "string") {
      return { enter: resolved, exit: resolved };
    }

    return resolved ?? {};
  }
}
