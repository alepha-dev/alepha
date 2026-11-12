import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "./utils.ts";

/**
 * Marks an element as an entry of the nearest {@link PageOutline}.
 *
 * Spread it on any element that carries an `id`: the outline lists it, links
 * `#id` to it, and highlights it while it is the section being read. The value
 * is the label; leave it empty and the outline reads the text of the first
 * descendant marked `data-outline-label` instead, which is how a section whose
 * title is a ReactNode still gets a plain-text entry.
 */
export const outlineEntry = (label?: string) => ({
  "data-outline": label ?? "",
});

interface OutlineItem {
  id: string;
  label: string;
}

export interface PageOutlineProps {
  /**
   * The page itself. Every descendant with an `id` and a `data-outline`
   * attribute (see {@link outlineEntry}) becomes an entry, in document order.
   */
  children: ReactNode;

  /**
   * Heading above the entries.
   *
   * @default "On this page"
   */
  title?: ReactNode;

  /**
   * Classes for the content column, which is where a page sets its measure
   * (`max-w-3xl`) and its padding.
   */
  contentClassName?: string;

  className?: string;
}

/**
 * A page with an "on this page" rail floating to the right of its content.
 *
 * The rail is sticky, highlights the entry being read, and puts the entry's
 * `#id` in the address bar on click, so the link a reader copies opens the
 * page on that section. It only shows when the page has room for it: the
 * width is measured on the outline's own box (a container query, `@5xl`, i.e.
 * 64rem), not on the viewport, because a page inside an app shell with a
 * sidebar is much narrower than the screen. On a tablet or a phone the rail
 * is gone and the content takes the whole width.
 *
 * Entries are read from the DOM rather than passed in, so a section that
 * renders conditionally (a credential that does not exist yet, a block the
 * reader has no rank for) appears and disappears from the rail on its own.
 * Fewer than two entries draw no rail: a single section needs no index.
 *
 * ## Deep links
 *
 * The router already scrolls to `#id` after a navigation, but only once the
 * target exists, and that is too early on a page whose sections load their own
 * data: at hydration the page is a few hundred pixels tall, the scroll lands
 * short, and the content then grows underneath it. The outline keeps the
 * target at the top while the content resizes, for up to three seconds after
 * mount, and lets go at the first wheel, touch, key or pointer press, so it
 * never fights the reader.
 */
export const PageOutline = (props: PageOutlineProps) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string>();
  // While a click's smooth scroll runs, the spy would walk the highlight
  // through every section in between; hold it on the clicked entry instead.
  const pinnedRef = useRef<string | null>(null);

  // Collect entries, and keep collecting as the page renders more of itself.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    // The hash this page was opened on, held until it is reached for good.
    let pendingHash: string | null =
      decodeURIComponent(window.location.hash.slice(1)) || null;
    const deadline = performance.now() + 3000;

    const settleHash = () => {
      if (!pendingHash) return;
      if (performance.now() > deadline) {
        release();
        return;
      }
      const target = document.getElementById(pendingHash);
      if (!target?.hasAttribute("data-outline") || !root.contains(target)) {
        return;
      }
      pinnedRef.current = pendingHash;
      setActiveId(pendingHash);
      target.scrollIntoView?.();
    };

    const release = () => {
      if (pendingHash && pinnedRef.current === pendingHash) {
        pinnedRef.current = null;
      }
      pendingHash = null;
    };

    const collect = () => {
      const next = Array.from(
        root.querySelectorAll<HTMLElement>("[data-outline][id]"),
      ).map((el) => ({
        id: el.id,
        label:
          el.dataset.outline ||
          el.querySelector("[data-outline-label]")?.textContent?.trim() ||
          el.id,
      }));
      setItems((prev) =>
        prev.length === next.length &&
        prev.every((p, i) => p.id === next[i].id && p.label === next[i].label)
          ? prev
          : next,
      );
      settleHash();
    };

    collect();
    const observer = new MutationObserver(collect);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributeFilter: ["id", "data-outline"],
    });
    // A section above the target growing (its data arrived) pushes the target
    // down without any mutation inside the outline's own subtree.
    const resizes =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(settleHash);
    resizes?.observe(root);

    const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const type of inputs) {
      window.addEventListener(type, release, { capture: true, passive: true });
    }
    const timer = setTimeout(release, 3000);

    return () => {
      observer.disconnect();
      resizes?.disconnect();
      clearTimeout(timer);
      for (const type of inputs) {
        window.removeEventListener(type, release, { capture: true });
      }
    };
  }, []);

  // Scroll spy: the active entry is the last one whose top has crossed the
  // upper third of the viewport.
  useEffect(() => {
    if (items.length === 0) return;

    const elements = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    const update = () => {
      if (pinnedRef.current) return;
      const line = window.innerHeight / 3;
      let current = elements[0]?.id;
      for (const el of elements) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
      }
      setActiveId(current);
    };

    update();
    // Capture phase: the page may scroll inside an app shell's container,
    // not the window, and `scroll` does not bubble.
    document.addEventListener("scroll", update, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      document.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [items]);

  const onClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    // A plain `#id` link would go through the router as a navigation; this is
    // only a scroll, so it stays out of history as one.
    event.preventDefault();
    history.replaceState(history.state, "", `#${id}`);
    setActiveId(id);
    pinnedRef.current = id;
    target.scrollIntoView?.({ behavior: "smooth", block: "start" });

    let last = Number.NaN;
    let still = 0;
    const settle = () => {
      if (pinnedRef.current !== id) return;
      const top = target.getBoundingClientRect().top;
      still = Math.abs(top - last) < 1 ? still + 1 : 0;
      last = top;
      if (still >= 5) {
        pinnedRef.current = null;
        return;
      }
      requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
  };

  const showRail = items.length > 1;

  return (
    <div
      data-slot="page-outline"
      className={cn("@container w-full", props.className)}
    >
      <div className="mx-auto flex w-full justify-center gap-8">
        <div
          ref={contentRef}
          className={cn("min-w-0 flex-1", props.contentClassName)}
        >
          {props.children}
        </div>
        {showRail ? (
          <nav
            aria-label={
              typeof props.title === "string" ? props.title : "On this page"
            }
            className="hidden w-48 shrink-0 @5xl:block"
          >
            <div className="sticky top-4 flex flex-col gap-2 py-4">
              <span className="text-muted-foreground text-xs">
                {props.title ?? "On this page"}
              </span>
              <ul className="border-border flex flex-col border-l">
                {items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        onClick={(event) => onClick(event, item.id)}
                        aria-current={active ? "location" : undefined}
                        className={cn(
                          "-ml-px block border-l py-1 pl-3 text-sm transition-colors",
                          active
                            ? "border-primary text-foreground"
                            : "text-muted-foreground hover:text-foreground border-transparent",
                        )}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
};
