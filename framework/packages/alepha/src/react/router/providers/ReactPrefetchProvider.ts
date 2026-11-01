import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { ReactBrowserRouterProvider } from "./ReactBrowserRouterProvider.ts";
import type { PageRoute } from "./ReactPageProvider.ts";
import { isPageRoute } from "./ReactPageProvider.ts";
import { RouterLocaleProvider } from "./RouterLocaleProvider.ts";

/**
 * Fetches a page's code before it is clicked: the `lazy` chunks of the page and
 * of its layouts, nothing else.
 *
 * The attribute is the API, on the model of the anchor interceptor: a delegated
 * listener reads `data-prefetch`, so a plain `<a>` works as well as a `Link`,
 * and no element holds a listener of its own.
 *
 * ⚠️ A failure is swallowed here, never handed to the chunk-error reload of
 * `ReactPageProvider`: an orphaned chunk after a deploy must not reload the
 * page under a hover. The navigation, if it comes, meets the failure itself.
 */
export class ReactPrefetchProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly router = $inject(ReactBrowserRouterProvider);
  protected readonly localeProvider = $inject(RouterLocaleProvider);

  /**
   * How long the pointer stays on a link before it counts as intent.
   */
  protected readonly hoverDelay = 100;

  /**
   * Chunks fetched at once. The rest of a burst, a list scrolled past, waits.
   */
  protected readonly maxInFlight = 4;

  protected readonly started = new WeakSet<object>();
  protected readonly queue: Array<() => Promise<unknown>> = [];
  protected inFlight = 0;

  protected hoverTimer?: { clear: () => void };
  protected hovered?: Element;
  protected observer?: IntersectionObserver;

  /**
   * Off for a visitor who asked the browser to save data.
   */
  protected get saveData(): boolean {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    return connection?.saveData === true;
  }

  /**
   * Fetch the code of the page at `url`, a path without the base. A URL no
   * page answers does nothing: prefetching is never an error.
   */
  public prefetch(url: string): void {
    if (this.saveData) {
      return;
    }

    for (const lazy of this.chunksOf(url)) {
      if (this.started.has(lazy)) {
        continue;
      }
      this.started.add(lazy);
      this.queue.push(lazy);
    }

    this.drain();
  }

  /**
   * The `lazy` of the page at `url` and of every layout above it, the
   * overlay's included: which of the two a navigation renders depends on what
   * is on screen when it happens.
   */
  protected chunksOf(url: string): Array<() => Promise<unknown>> {
    const { pathname } = new URL(url, "http://localhost");
    const path = this.localeProvider.enabled
      ? this.localeProvider.detect(pathname).pathname
      : pathname;

    let page: PageRoute | undefined;
    try {
      const { route } = this.router.match(path);
      page = isPageRoute(route) ? route.page : undefined;
    } catch {
      return [];
    }

    const chunks: Array<() => Promise<unknown>> = [];
    for (let it = page; it; it = it.parent) {
      if (it.lazy) chunks.push(it.lazy);
      if (it.overlay?.lazy) chunks.push(it.overlay.lazy);
    }
    return chunks;
  }

  protected drain(): void {
    while (this.inFlight < this.maxInFlight && this.queue.length > 0) {
      const lazy = this.queue.shift()!;
      this.inFlight += 1;
      Promise.resolve()
        .then(lazy)
        .catch((error) => {
          // Not `started` any more: the next hover may try again.
          this.started.delete(lazy);
          this.log.debug("Prefetch failed", error);
        })
        .finally(() => {
          this.inFlight -= 1;
          this.drain();
        });
    }
  }

  /**
   * Start listening. Called once the first screen is up.
   */
  public attach(): void {
    const document = window.document;

    document.addEventListener("mouseover", (event) => {
      const target = (event.target as Element | null)?.closest?.(
        '[data-prefetch="hover"]',
      );
      if (target === this.hovered) {
        return;
      }
      this.hoverTimer?.clear();
      this.hovered = target ?? undefined;
      if (target) {
        this.hoverTimer = this.dateTime.createTimeout(
          () => this.prefetchElement(target),
          this.hoverDelay,
        );
      }
    });

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this.observer?.unobserve(entry.target);
          this.prefetchElement(entry.target);
        }
      }
    });

    this.observeWithin(document.body);

    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            this.observeWithin(node as Element);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  protected observeWithin(element: Element): void {
    const selector = '[data-prefetch="visible"]';
    if (element.matches(selector)) {
      this.observer?.observe(element);
    }
    for (const it of element.querySelectorAll(selector)) {
      this.observer?.observe(it);
    }
  }

  protected prefetchElement(element: Element): void {
    const href = element.getAttribute("href");
    if (!href) {
      return;
    }
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin) {
      this.prefetch(url.pathname + url.search);
    }
  }
}
