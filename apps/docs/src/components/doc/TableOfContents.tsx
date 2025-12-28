import { useRouter } from "@alepha/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
    <div
      className="visible-xl"
      style={{
        width: 280,
        minHeight: "100%",
        background: "var(--color-surface-subtle)",
      }}
    >
      <div className="sticky top-0" style={{ paddingTop: 16 }}>
        {/* Header */}
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--color-text-muted)",
            padding: "12px 20px",
          }}
        >
          On This Page
        </div>

        {/* ToC Items */}
        <div
          className="scroll-area"
          style={{ maxHeight: "calc(100vh - 120px)", padding: "8px 16px" }}
        >
          <TocItems key={props.name} />
        </div>
      </div>
    </div>
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

    // Set initial active to first heading
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
          // If we have a clicked ID, ignore observer updates
          if (clickedIdRef.current) return;

          // Find the topmost visible heading
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
      // Lock to this ID - prevents observer from changing it
      clickedIdRef.current = id;
      setActiveId(id);

      // Update URL hash without triggering scroll
      history.replaceState(null, "", `#${id}`);

      // Detect scroll end by monitoring element position stability
      let lastTop = element.getBoundingClientRect().top;
      let stableFrames = 0;

      const checkScrollEnd = () => {
        const currentTop = element.getBoundingClientRect().top;
        if (Math.abs(currentTop - lastTop) < 1) {
          stableFrames++;
          // Element position stable for 5 frames = scroll complete
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

      // Start checking after a small delay to let scroll begin
      requestAnimationFrame(() => requestAnimationFrame(checkScrollEnd));

      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Depth-based styling
  const getDepthStyle = (depth: number, isActive: boolean) => {
    return {
      fontSize: depth === 2 ? 12 : 11,
      fontWeight: depth === 2 ? 500 : 400,
      opacity: isActive ? 1 : depth === 2 ? 0.7 : 0.5,
    };
  };

  if (headings.length === 0) {
    return (
      <div
        style={{
          color: "var(--color-text-muted)",
          fontSize: 12,
          fontStyle: "italic",
        }}
      >
        No headings found...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col"
      style={{
        position: "relative",
      }}
    >
      {/* Floating indicator bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: indicatorStyle.top,
          height: indicatorStyle.height,
          width: 2,
          background: "var(--color-accent)",
          borderRadius: 1,
          transition: "top 0.2s ease-out, height 0.2s ease-out",
          zIndex: 1,
        }}
      />

      {headings.map((heading) => {
        const isActive = activeId === heading.id;
        const depthStyle = getDepthStyle(heading.depth, isActive);
        const indent = (heading.depth - 2) * 8;

        return (
          <button
            key={heading.id}
            ref={(el) => {
              if (el) itemRefs.current.set(heading.id, el);
            }}
            type="button"
            onClick={() => handleClick(heading.id)}
            className="btn-reset text-left cursor-pointer toc-item truncate"
            style={{
              position: "relative",
              padding: "6px 12px",
              paddingLeft: 20 + indent,
              fontSize: depthStyle.fontSize,
              fontWeight: isActive ? 500 : depthStyle.fontWeight,
              color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
              opacity: depthStyle.opacity,
              transition: "color 0.15s ease, opacity 0.15s ease",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {heading.text}
          </button>
        );
      })}
    </div>
  );
};
