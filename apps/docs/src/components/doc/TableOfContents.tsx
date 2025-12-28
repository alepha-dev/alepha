import { useRouter } from "@alepha/react";
import { useEffect, useLayoutEffect, useState } from "react";

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
          className="scroll-area p-2"
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

  // Scroll spy with Intersection Observer
  useEffect(() => {
    if (headings.length === 0) return;

    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    // Track which headings are visible
    const visibleHeadings = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleHeadings.add(entry.target.id);
          } else {
            visibleHeadings.delete(entry.target.id);
          }
        }

        // Find the first visible heading in document order
        for (const heading of headings) {
          if (visibleHeadings.has(heading.id)) {
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
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      // Update active immediately for snappy feel
      setActiveId(id);
    }
  };

  // Depth-based styling
  const getDepthStyle = (depth: number, isActive: boolean) => {
    const baseIndent = 12;
    const indent = (depth - 2) * baseIndent;

    return {
      paddingLeft: indent,
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
    <div className="flex flex-col">
      {headings.map((heading) => {
        const isActive = activeId === heading.id;
        const depthStyle = getDepthStyle(heading.depth, isActive);

        return (
          <button
            key={heading.id}
            type="button"
            onClick={() => handleClick(heading.id)}
            className="btn-reset text-left cursor-pointer toc-item truncate"
            style={{
              padding: "5px 0",
              paddingLeft: depthStyle.paddingLeft,
              fontSize: depthStyle.fontSize,
              fontWeight: depthStyle.fontWeight,
              color: isActive ? "var(--term-green)" : "var(--term-text-dim)",
              opacity: depthStyle.opacity,
              transition: "color 0.15s, opacity 0.15s",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {heading.depth > 2 && <span style={{ opacity: 0.4 }}>└ </span>}
            {heading.text}
          </button>
        );
      })}
    </div>
  );
};
