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
      className="visible-xl texture-dots"
      style={{
        width: 280,
        minHeight: "100%",
        background: "var(--term-bg-elevated)",
        borderLeft: "1px solid var(--term-border)",
      }}
    >
      <div className="sticky top-0">
        {/* Header - same style as Explorer */}
        <div
          className="flex items-center gap-2 px-4 py-2"
          style={{
            borderBottom: "1px solid var(--term-border)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--term-text-dim)",
            background: "var(--term-bg-elevated)",
          }}
        >
          On This Page
        </div>

        {/* ToC Items */}
        <div
          className="scroll-area p-4"
          style={{ maxHeight: "calc(100vh - 60px)" }}
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
  const isScrollingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const visibleHeadingsRef = useRef<Set<string>>(new Set());

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

    const observer = new IntersectionObserver(
      (entries) => {
        // Skip updates during programmatic scroll
        if (isScrollingRef.current) return;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleHeadingsRef.current.add(entry.target.id);
          } else {
            visibleHeadingsRef.current.delete(entry.target.id);
          }
        }

        // Find the first visible heading in document order
        for (const heading of headings) {
          if (visibleHeadingsRef.current.has(heading.id)) {
            setActiveId(heading.id);
            break;
          }
        }
      },
      {
        rootMargin: "-64px 0px -70% 0px",
        threshold: [0, 0.5, 1],
      },
    );

    for (const el of elements) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  const handleClick = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      // Disable observer during programmatic scroll
      isScrollingRef.current = true;
      // Clear stale visibility data
      visibleHeadingsRef.current.clear();
      setActiveId(id);

      element.scrollIntoView({ behavior: "smooth", block: "start" });

      // Re-enable observer after scroll completes
      // Use longer timeout to ensure scroll is fully settled
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 1000);
    }
  };

  // Depth-based styling
  const getDepthStyle = (depth: number, isActive: boolean) => {
    return {
      fontSize: depth === 2 ? 13 : 12,
      fontWeight: depth === 2 ? 500 : 400,
      opacity: isActive ? 1 : depth === 2 ? 0.8 : 0.6,
    };
  };

  if (headings.length === 0) {
    return (
      <div
        style={{
          color: "var(--term-text-dim)",
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
        marginLeft: 4,
      }}
    >
      {/* Animated indicator bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: indicatorStyle.top,
          height: indicatorStyle.height,
          width: 2,
          background: "var(--term-green)",
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
            className={`btn-reset text-left cursor-pointer toc-item truncate ${isActive ? "active" : ""}`}
            style={{
              position: "relative",
              padding: "6px 10px",
              paddingLeft: 16 + indent,
              fontSize: depthStyle.fontSize,
              fontWeight: isActive ? 500 : depthStyle.fontWeight,
              color: isActive ? "var(--term-text)" : "var(--term-text-dim)",
              opacity: depthStyle.opacity,
              background: "transparent",
              borderRadius: "0 4px 4px 0",
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
