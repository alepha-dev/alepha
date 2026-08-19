import {
  $atom,
  $hook,
  $inject,
  $store,
  Alepha,
  type Infer,
  SchemaValidator,
  type State,
  z,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { BrowserHeadProvider } from "alepha/react/head";
import { LinkProvider } from "alepha/server/links";
import type { RouterPushOptions } from "../services/ReactRouter.ts";
import { ReactBrowserRouterProvider } from "./ReactBrowserRouterProvider.ts";
import type {
  PreviousLayerData,
  ReactRouterState,
} from "./ReactPageProvider.ts";

export type { RouterPushOptions } from "../services/ReactRouter.ts";

/**
 * React browser renderer configuration atom
 */
export const reactBrowserOptions = $atom({
  name: "alepha.react.browser.options",
  schema: z.object({
    /**
     * What the router does with scroll position after a navigation.
     *
     * - `auto` (default): what a browser does. A new navigation goes to the
     *   top, or to the `#hash` target when the URL has one; back and forward
     *   restore the position that entry was left at.
     * - `top`: always jump to the top, including on back/forward. This was the
     *   only behaviour before, and it is why Back appeared to "scroll up".
     * - `manual`: the router never touches scroll.
     */
    scrollRestoration: z.enum(["auto", "top", "manual"]),
    /**
     * Intercept clicks on plain `<a href="/...">` anchors and route them
     * through the SPA router, so authors don't need `<Link>` everywhere
     * (notably for SSR/Markdown HTML rendered as raw markup).
     *
     * Skips: modifier keys, non-primary mouse buttons, `target` other than
     * `_self`, `download`, `data-no-router`, non-http(s) schemes, hash-only
     * hrefs, external origins, and clicks already `defaultPrevented`.
     */
    interceptAnchorClicks: z.boolean().default(true),
  }),
  default: {
    scrollRestoration: "auto" as const,
    interceptAnchorClicks: true,
  },
});

export type ReactBrowserRendererOptions = Infer<
  typeof reactBrowserOptions.schema
>;

declare module "alepha" {
  interface State {
    [reactBrowserOptions.key]: ReactBrowserRendererOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ReactBrowserProvider {
  protected readonly log = $logger();
  protected readonly client = $inject(LinkProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly router = $inject(ReactBrowserRouterProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly browserHeadProvider = $inject(BrowserHeadProvider);
  protected readonly validator = $inject(SchemaValidator);

  protected readonly options = $store(reactBrowserOptions);

  /**
   * Scroll offset of every history entry we have visited, keyed by the id
   * stamped into `history.state`.
   *
   * A Map rather than `history.state` itself: the position has to be written
   * for the entry we are *leaving*, and by the time `popstate` fires the
   * browser has already swapped `history.state` to the entry we are arriving
   * at, so there is nowhere left to put it.
   */
  protected readonly scrollPositions = new Map<number, number>();

  /** Id of the entry currently on screen. */
  protected historyKey = 0;

  protected nextHistoryKey = 1;

  /**
   * How the navigation being rendered was started. Read once the transition
   * ends, to decide between restoring, anchoring and going to the top.
   *
   * Kept on the provider rather than threaded through `react:transition:end`
   * because the provider both starts every navigation and owns the hook, and
   * `transitionId` already serialises them.
   */
  protected navigationKind: "push" | "replace" | "pop" = "push";

  public get rootId() {
    return "root";
  }

  protected getRootElement() {
    const root = this.document.getElementById(this.rootId);
    if (root) {
      return root;
    }

    const div = this.document.createElement("div");
    div.id = this.rootId;

    this.document.body.prepend(div);

    return div;
  }

  public transitioning?: {
    to: string;
    from?: string;
  };

  /**
   * Monotonic counter used to detect stale (superseded) transitions.
   *
   * Each call to `render()` captures `++this.transitionId` and any
   * subsequent `render()` invalidates older in-flight transitions.
   * This prevents a slow page from racing past a newer navigation
   * (e.g. user clicks /pageA which has a 2s loader, then clicks /pageB
   * — pageB must remain the committed page).
   */
  protected transitionId = 0;

  public get state(): ReactRouterState {
    return this.alepha.store.get("alepha.react.router.state")!;
  }

  /**
   * Accessor for Document DOM API.
   */
  public get document() {
    return window.document;
  }

  /**
   * Accessor for History DOM API.
   */
  public get history() {
    return window.history;
  }

  /**
   * Accessor for Location DOM API.
   */
  public get location() {
    return window.location;
  }

  public get base() {
    const base = import.meta.env?.BASE_URL;
    if (!base || base === "/") {
      return "";
    }

    return base;
  }

  public get url(): string {
    const url =
      this.location.pathname + this.location.search + this.location.hash;
    if (this.base) {
      return url.replace(this.base, "");
    }
    return url;
  }

  public pushState(path: string, replace?: boolean) {
    const url = this.base + path;

    if (replace) {
      // Same entry, same id: a replace does not create a place to come back to.
      this.history.replaceState({ alephaKey: this.historyKey }, "", url);
    } else {
      this.historyKey = this.nextHistoryKey++;
      this.history.pushState({ alephaKey: this.historyKey }, "", url);
    }
  }

  /**
   * The element that actually scrolls.
   *
   * Two layouts are in play: pages that let the document scroll, and shells
   * that keep the header fixed and scroll an inner pane instead. For the
   * second kind `window.scrollTo` is a no-op, so a layout marks its pane with
   * `data-scroll-container` and the router drives that instead.
   */
  protected getScroller(): HTMLElement | Window | undefined {
    if (typeof window === "undefined") {
      return undefined;
    }
    const marked = this.document.querySelector<HTMLElement>(
      "[data-scroll-container]",
    );
    if (marked && marked.scrollHeight > marked.clientHeight) {
      return marked;
    }
    return window;
  }

  protected getScroll(): number {
    const el = this.getScroller();
    if (!el) return 0;
    return el instanceof Window ? el.scrollY : el.scrollTop;
  }

  protected setScroll(top: number): void {
    const el = this.getScroller();
    if (!el) return;
    if (el instanceof Window) {
      el.scrollTo({ top, behavior: "instant" as ScrollBehavior });
    } else {
      el.scrollTop = top;
    }
  }

  /** Remember where the entry on screen is, before we leave it. */
  protected saveScroll(): void {
    if (typeof window === "undefined" || this.alepha.isTest()) return;
    this.scrollPositions.set(this.historyKey, this.getScroll());
  }

  public async invalidate(props?: Record<string, any>) {
    const previous: PreviousLayerData[] = [];

    this.log.trace("Invalidating layers");

    if (props) {
      const [key] = Object.keys(props);
      const value = props[key];

      for (const layer of this.state.layers) {
        if (layer.props?.[key]) {
          previous.push({
            ...layer,
            props: {
              ...layer.props,
              [key]: value,
            },
          });
          break;
        }
        previous.push(layer);
      }
    }

    await this.render({ previous });
  }

  public async push(
    url: string,
    options: RouterPushOptions = {},
  ): Promise<void> {
    this.log.trace(`Going to ${url}`, {
      url,
      options,
    });

    // Before anything renders: the offset belongs to the entry we are on, and
    // it is gone the moment the new view paints.
    this.saveScroll();
    this.navigationKind = options.replace ? "replace" : "push";

    const myTransitionId = ++this.transitionId;

    await this.render({
      url,
      previous: options.force ? [] : this.state.layers,
      meta: options.meta,
      transitionId: myTransitionId,
    });

    // A newer navigation has superseded us — bail out without touching
    // history, otherwise we'd push a duplicate/stale entry.
    if (myTransitionId !== this.transitionId) {
      return;
    }

    // when redirecting in browser
    // The hash is part of the identity of the committed route: without it,
    // pushing "/docs#section" never matches "/docs" and takes the redirect
    // branch below, which rewrites history without the fragment.
    const committed =
      this.state.url.pathname + this.state.url.search + this.state.url.hash;

    if (committed !== url) {
      // Forward `replace`: a loader redirect used to always PUSH, so history
      // grew and Back landed on an entry that immediately redirected again.
      this.pushState(committed, options?.replace);
      return;
    }

    this.pushState(url, options.replace);
  }

  protected async render(options: RouterRenderOptions = {}): Promise<void> {
    const myTransitionId = options.transitionId ?? ++this.transitionId;
    // `this.state` is undefined until the FIRST successful (non-redirect) render commits it
    // (the getter reads an atom nothing has ever `set` yet). The redirect-follow-up call below
    // (`return await this.render({ url: redirect, transitionId: myTransitionId })`) omits
    // `previous` entirely, so when the very first render's route loader throws a Redirection,
    // this.state is still unset — fall back to an empty layer stack instead of crashing when
    // reading `.layers` off `undefined`.
    // Optional-chained with a `[]` fallback, matching the same defensive read this file already
    // uses for `this.state?.url.pathname` a few lines below.
    const previous = options.previous ?? this.state?.layers ?? [];
    const url = options.url ?? this.url;
    const start = this.dateTimeProvider.now();

    this.transitioning = {
      to: url,
      from: this.state?.url.pathname,
    };

    this.log.debug("Transitioning...", {
      to: url,
    });

    const isStale = () => this.transitionId !== myTransitionId;

    const redirect = await this.router.transition(
      new URL(`http://localhost${url}`),
      previous,
      options.meta,
      isStale,
    );

    // A newer navigation has superseded us between the time we awaited
    // transition() and now. Drop everything: don't follow redirects, don't
    // log success, don't clear `transitioning` (the newer render owns it).
    if (isStale()) {
      this.log.debug("Transition superseded — discarding stale result", {
        to: url,
      });
      return;
    }

    if (redirect) {
      this.log.info("Redirecting to", {
        redirect,
      });

      // if redirect is an absolute URL, use window.location.href (full page reload)
      if (redirect.startsWith("http")) {
        window.location.href = redirect;
      } else {
        // if redirect is a relative URL, use render() (single page app).
        // Inherit the current transitionId: a redirect is a continuation of
        // the same navigation, not a new one. Allocating a fresh id would
        // mark the caller's `push()` stale, so it would skip `pushState()`
        // and the URL bar would never sync to the redirect target.
        return await this.render({
          url: redirect,
          transitionId: myTransitionId,
        });
      }
    }

    const ms = this.dateTimeProvider.now().diff(start);
    this.log.info(`Transition OK [${ms}ms]`, this.transitioning);

    this.transitioning = undefined;
  }

  /**
   * Get embedded layers from the server.
   */
  protected getHydrationState(): ReactHydrationState | undefined {
    if (this.hydrationState === undefined) {
      this.hydrationState = this.readHydrationState() ?? null;
    }
    return this.hydrationState ?? undefined;
  }

  /**
   * Cached `#__ssr` payload. `null` means "read, and there was none" — as
   * opposed to `undefined`, "not read yet".
   */
  protected hydrationState?: ReactHydrationState | null;

  protected readHydrationState(): ReactHydrationState | undefined {
    try {
      const el = this.document.getElementById("__ssr");
      if (el?.textContent) {
        return JSON.parse(el.textContent) as ReactHydrationState;
      }
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Install the SSR payload into the store BEFORE any `start` hook runs.
   *
   * Hydration is inbound state: it is what the server already decided, so the
   * app must boot with it in place, not adopt it afterwards. Applying it in
   * `ready` (where the render happens) left every `start` hook reading a store
   * the server had already filled in — they saw defaults and configured
   * themselves against a value that was about to change.
   *
   * i18n is the case that exposed it. `I18nProvider`'s `start` hook preloads
   * the dictionaries for the active language; with the payload unapplied it
   * read `lang` as empty, fell back to `fallbackLang`, and preloaded the wrong
   * dictionary. `applyHydration` then set the real language in `ready` — but
   * `StateManager.set` emits `state:mutate` fire-and-forget, so the loader for
   * the real language was still in flight when `render()` hydrated React one
   * line later. `translate()` found the active dictionary empty, fell through
   * to the loaded fallback one, and rendered the whole page in the fallback
   * language while `lang` already said otherwise — a hydration mismatch that
   * never repaired itself, because finishing a dictionary load notifies nobody.
   *
   * Applying the payload here closes that window at the source: `start` hooks
   * see the language the server actually chose, and preload against it.
   */
  protected readonly hydrateBeforeStart = $hook({
    on: "start",
    priority: "first",
    handler: () => {
      const hydration = this.getHydrationState();
      if (hydration) {
        this.applyHydration(hydration);
      }
    },
  });

  /**
   * Apply the SSR hydration payload (the `#__ssr` script tag) to the atom
   * store.
   *
   * Every key except `alepha.react.router.layers` is treated as an atom
   * value. A registered atom's value is explicitly schema-validated: an
   * invalid value is dropped (warn + keep the atom's default) instead of
   * being trusted, so a tampered payload can't smuggle bad data into a
   * validated atom. Atoms not registered yet fall through to
   * `Alepha.set()`, which lets `StateManager.register()` decode them
   * against the schema the moment they first get used.
   *
   * `alepha.react.router.layers` is deliberately skipped by this loop: it
   * carries render instructions (`part`, `name`, `config`, `props`,
   * `error`), not atom values. Those are NOT hardened here and are trusted
   * as-is from the SSR payload — a tampered payload can still influence
   * rendering through this key. Validating router layers is separate,
   * future work; this method only guarantees atom values.
   */
  protected applyHydration(hydration: ReactHydrationState): void {
    for (const [key, value] of Object.entries(hydration)) {
      if (key === "alepha.react.router.layers") {
        // Render instructions, not an atom value — see the method doc
        // above. Intentionally trusted as-is.
        continue;
      }

      const atom = this.alepha.store.getAtom(key);
      if (atom) {
        const result = this.validator.safeValidate(atom.schema, value);
        if (!result.success) {
          this.log.warn(
            `Hydrated value for atom "${key}" failed schema validation, keeping default`,
          );
          continue;
        }
        this.alepha.store.set(key as keyof State, result.data as any, {
          skipValidation: true,
        });
      } else {
        // Not registered yet — register() will decode it when the atom
        // first gets used.
        this.alepha.set(key as keyof State, value);
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * What should happen to the scroll offset for the navigation that just
   * finished. Split out from the hook so it can be tested without a DOM: the
   * hook itself is skipped under `isTest()`, which is exactly the branch the
   * "Back scrolls to top" bug lived in.
   */
  public resolveScrollAction(hash?: string): ScrollAction {
    const mode = this.options.scrollRestoration;

    if (mode === "manual") {
      return { type: "none" };
    }

    // `top` keeps the old behaviour for anyone who wants it, back included.
    if (mode === "top") {
      return { type: "top" };
    }

    if (this.navigationKind === "pop") {
      return {
        type: "restore",
        top: this.scrollPositions.get(this.historyKey) ?? 0,
      };
    }

    // A new entry. An anchor in the URL wins over the top, which is also what
    // makes cross-page `/docs/page#section` links land on the section.
    if (hash) {
      return { type: "hash", hash };
    }

    return { type: "top" };
  }

  protected readonly onTransitionEnd = $hook({
    on: "react:transition:end",
    handler: ({ state }) => {
      if (typeof window === "undefined" || this.alepha.isTest()) {
        return;
      }

      const action = this.resolveScrollAction(state.url.hash?.slice(1));
      this.log.trace("Scroll action", action);

      switch (action.type) {
        case "none":
          return;
        case "top":
          // Synchronous: the top is reachable at any height, so it needs no
          // wait for layout and avoids a visible jump.
          this.setScroll(0);
          return;
        case "restore":
          this.restoreScroll(action.top);
          return;
        case "hash":
          this.restoreScroll(0, action.hash);
          return;
      }
    },
  });

  /**
   * Apply a scroll offset once the new view is tall enough to hold it.
   *
   * Setting it synchronously is too early: the layers have committed but the
   * browser has not laid the new content out, so the container is still short
   * and the offset clamps — restoring 4200px into a page that is momentarily
   * 900px tall silently lands at 0. A fixed one- or two-frame delay is no
   * better, because how long the real height takes depends on the page.
   *
   * So retry per frame until the offset sticks, giving up after
   * `maxScrollRestoreFrames` (~half a second) so a target that is genuinely
   * unreachable — the page really is shorter now — cannot spin forever.
   * A newer navigation also cancels it: that one owns the scroll position now.
   */
  protected readonly maxScrollRestoreFrames = 30;

  /**
   * Run `fn` on the next frame.
   *
   * `requestAnimationFrame` does not fire at all while the document is
   * hidden — a background tab, or a restored session — so a restore scheduled
   * that way would simply never happen and the page would be left at the top
   * when the reader came back to it. Fall back to a timer in that case.
   */
  protected get documentHidden(): boolean {
    return typeof document !== "undefined" && document.hidden;
  }

  protected scheduleTimeout(fn: () => void): void {
    setTimeout(fn, 16);
  }

  protected scheduleFrame(fn: () => void): void {
    requestAnimationFrame(fn);
  }

  protected nextFrame(fn: () => void): void {
    if (this.documentHidden) {
      this.scheduleTimeout(fn);
      return;
    }
    this.scheduleFrame(fn);
  }

  protected restoreScroll(top: number, hash?: string): void {
    const ownTransitionId = this.transitionId;
    let frames = 0;

    const step = () => {
      // Superseded: the user navigated again while we were still settling.
      if (this.transitionId !== ownTransitionId) {
        return;
      }

      if (hash) {
        const target = this.document.getElementById(hash);
        if (target) {
          target.scrollIntoView();
          return;
        }
      } else {
        this.setScroll(top);
        if (Math.abs(this.getScroll() - top) <= 1) {
          return;
        }
      }

      if (++frames < this.maxScrollRestoreFrames) {
        this.nextFrame(step);
      }
    };

    // Try straight away: when the view is already laid out (a cached page, a
    // short one) this lands in the same frame and there is no visible jump.
    step();
  }

  public readonly ready = $hook({
    on: "ready",
    handler: async () => {
      // Already applied by `hydrateBeforeStart`; this only needs the render
      // instructions, which are not atom values and are not applied to the
      // store at all.
      const hydration = this.getHydrationState();
      const previous = hydration?.["alepha.react.router.layers"] ?? [];

      await this.render({ previous });

      const element = this.router.root(this.state);

      await this.alepha.events.emit("react:browser:render", {
        element,
        root: this.getRootElement(),
        hydration,
        state: this.state,
      });

      // The browser would otherwise restore scroll itself on back/forward,
      // and then this router would immediately overwrite it. Own it instead.
      if (this.options.scrollRestoration !== "manual") {
        try {
          this.history.scrollRestoration = "manual";
        } catch {
          // Not supported (or blocked); the router's own restore still works.
        }
      }

      // Stamp the entry the app booted on, so returning to it can be restored
      // like any other.
      this.history.replaceState(
        { ...(this.history.state ?? {}), alephaKey: this.historyKey },
        "",
        this.location.href,
      );

      window.addEventListener("popstate", () => {
        // `popstate` fires while the outgoing view is still on screen, so the
        // offset now on the page belongs to the entry we are leaving. Save it
        // under the id we were on, before adopting the one we arrived at.
        this.saveScroll();
        this.navigationKind = "pop";
        const key = (this.history.state as { alephaKey?: number } | null)
          ?.alephaKey;
        this.historyKey = typeof key === "number" ? key : 0;

        // Skip rendering only if the entire URL (path + search) is
        // unchanged from current state. Comparing pathname alone misses
        // back/forward between two URLs that share a path but differ
        // in query params (e.g. an in-page filter `?dir=5` → root) —
        // those legitimately need a re-render. If you want to update
        // query params silently without triggering a render, use
        // history.replaceState directly; popstate by definition means
        // the user navigated.
        if (
          this.base + this.state.url.pathname === this.location.pathname &&
          (this.state.url.search ?? "") === (this.location.search ?? "")
        ) {
          return;
        }

        this.log.debug("Popstate event triggered - rendering new state", {
          url: this.location.pathname + this.location.search,
        });

        this.render();
      });

      this.attachAnchorInterceptor();
    },
  });

  /**
   * Attach a delegated click listener that routes plain `<a href="/...">`
   * clicks through the SPA router. Returns a detach function (used in tests).
   *
   * Bails out on modifier keys, non-primary mouse buttons, `target`, `download`,
   * `data-no-router`, hash-only/external/non-http hrefs, and already-prevented
   * events. Honors the runtime `interceptAnchorClicks` flag.
   */
  protected attachAnchorInterceptor(): () => void {
    const onClick = (ev: MouseEvent) => {
      if (!this.options.interceptAnchorClicks) return;
      if (ev.defaultPrevented) return;
      if (ev.button !== 0) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

      const node = ev.target as Element | null;
      const a = node?.closest?.("a");
      if (!a) return;

      if (a.hasAttribute("download")) return;
      if (a.hasAttribute("data-no-router")) return;

      const target = a.getAttribute("target");
      if (target && target !== "_self") return;

      const href = a.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        // absolute scheme: only intercept if it points at our own origin
        let url: URL;
        try {
          url = new URL(href);
        } catch {
          return;
        }
        if (url.origin !== this.location.origin) return;
        ev.preventDefault();
        const path = url.pathname + url.search + url.hash;
        this.push(this.stripBase(path)).catch((e) => this.log.error(e));
        return;
      }

      ev.preventDefault();
      const url = new URL(href, this.location.href);
      const path = url.pathname + url.search + url.hash;
      this.push(this.stripBase(path)).catch((e) => this.log.error(e));
    };

    this.document.addEventListener("click", onClick);
    return () => this.document.removeEventListener("click", onClick);
  }

  protected stripBase(path: string): string {
    if (this.base && path.startsWith(this.base)) {
      return path.slice(this.base.length) || "/";
    }
    return path;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type ReactHydrationState = {
  "alepha.react.router.layers"?: Array<PreviousLayerData>;
} & {
  [key: string]: any;
};

/**
 * Outcome of {@link ReactBrowserProvider.resolveScrollAction}.
 */
export type ScrollAction =
  | { type: "none" }
  | { type: "top" }
  | { type: "restore"; top: number }
  | { type: "hash"; hash: string };

export interface RouterRenderOptions {
  url?: string;
  previous?: PreviousLayerData[];
  meta?: Record<string, any>;
  /**
   * Transition id used to detect supersession by a newer navigation.
   * When omitted, render() allocates a fresh id internally.
   */
  transitionId?: number;
}
