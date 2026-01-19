import { useRouter } from "@alepha/react/router";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "./TableOfContents.module.css";

interface HeadingItem {
  id: string;
  text: string;
  depth: number;
}

interface TableOfContentsProps {
  name: string;
}

const TableOfContents = (props: TableOfContentsProps) => {
  const router = useRouter();

  useLayoutEffect(() => {
    (window as any).go = (url: string) => router.go(url);
  }, [props.name, router]);

  return (
    <nav
      className={`visible-xl ${styles.container}`}
      aria-label="Table of contents"
    >
      <div className={styles.sticky}>
        <div className={styles.header} id="toc-heading">
          On This Page
        </div>
        <div
          className={`scroll-area ${styles.scrollArea}`}
          role="list"
          aria-labelledby="toc-heading"
        >
          <TocItems key={props.name} />
        </div>
      </div>
    </nav>
  );
};

export default TableOfContents;

// =============================================================================
// TOC ITEMS
// =============================================================================

const TocItems = () => {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [indicatorStyle, setIndicatorStyle] = useState({ top: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const clickedIdRef = useRef<string | null>(null);

  // Parse headings from DOM
  useEffect(() => {
    const elements = document.querySelectorAll("#html-content [data-heading]");
    const items = Array.from(elements).map((el) => ({
      id: el.id,
      text: el.getAttribute("data-heading") || "",
      depth: Number(el.getAttribute("data-depth") || 2),
    }));
    setHeadings(items);

    if (items.length > 0 && !activeId) {
      setActiveId(items[0].id);
    }
  }, []);

  // Update indicator position when active changes
  useEffect(() => {
    if (!activeId || !containerRef.current) return;

    const activeItem = itemRefs.current.get(activeId);
    if (activeItem) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();

      setIndicatorStyle({
        top: itemRect.top - containerRect.top,
        height: itemRect.height,
      });
    }
  }, [activeId, headings]);

  // Scroll spy with Intersection Observer
  useEffect(() => {
    if (headings.length === 0) return;

    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const createObserver = () => {
      return new IntersectionObserver(
        (entries) => {
          if (clickedIdRef.current) return;

          let topMostId: string | null = null;
          let topMostTop = Infinity;

          for (const entry of entries) {
            if (entry.isIntersecting) {
              const rect = entry.boundingClientRect;
              if (rect.top < topMostTop && rect.top >= -20) {
                topMostTop = rect.top;
                topMostId = entry.target.id;
              }
            }
          }

          if (topMostId) {
            setActiveId(topMostId);
          }
        },
        {
          rootMargin: "-20px 0px -60% 0px",
          threshold: [0, 1],
        },
      );
    };

    observerRef.current = createObserver();

    for (const el of elements) {
      observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [headings]);

  const handleClick = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      clickedIdRef.current = id;
      setActiveId(id);
      history.replaceState(null, "", `#${id}`);

      let lastTop = element.getBoundingClientRect().top;
      let stableFrames = 0;

      const checkScrollEnd = () => {
        const currentTop = element.getBoundingClientRect().top;
        if (Math.abs(currentTop - lastTop) < 1) {
          stableFrames++;
          if (stableFrames >= 5) {
            clickedIdRef.current = null;
            return;
          }
        } else {
          stableFrames = 0;
          lastTop = currentTop;
        }
        requestAnimationFrame(checkScrollEnd);
      };

      requestAnimationFrame(() => requestAnimationFrame(checkScrollEnd));
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (headings.length === 0) {
    return <div className={styles.empty}>No headings found...</div>;
  }

  return (
    <div
      ref={containerRef}
      className={styles.itemsContainer}
      style={
        {
          "--indicator-top": `${indicatorStyle.top}px`,
          "--indicator-height": `${indicatorStyle.height}px`,
        } as CSSProperties
      }
    >
      <div className={styles.indicator} aria-hidden="true" />

      {headings.map((heading) => {
        const isActive = activeId === heading.id;
        const indent = (heading.depth - 2) * 8;
        const depthClass = heading.depth === 2 ? styles.itemH2 : styles.itemH3;

        return (
          <button
            key={heading.id}
            ref={(el) => {
              if (el) itemRefs.current.set(heading.id, el);
            }}
            type="button"
            role="listitem"
            onClick={() => handleClick(heading.id)}
            aria-current={isActive ? "location" : undefined}
            className={`${styles.item} ${depthClass} ${isActive ? styles.itemActive : ""}`}
            style={{ "--item-indent": `${20 + indent}px` } as CSSProperties}
          >
            {heading.text}
          </button>
        );
      })}
    </div>
  );
};
