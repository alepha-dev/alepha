import { useRouter } from "@alepha/react";
import { IconFile } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DocNode, tree } from "../../config/docs.ts";

// Helper to flatten tree
const flattenTree = (nodes: DocNode[]): DocNode[] => {
  const result: DocNode[] = [];
  for (const node of nodes) {
    if (node.href) {
      result.push(node);
    }
    if (node.children) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
};

const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const resultsRef = useRef<HTMLDivElement>(null);

  // Flatten tree for search
  const allDocs = flattenTree(tree);

  const filtered = query
    ? allDocs.filter(
        (doc) =>
          doc.name.toLowerCase().includes(query.toLowerCase()) ||
          doc.href?.toLowerCase().includes(query.toLowerCase()),
      )
    : allDocs.slice(0, 10);

  // Reset selected index when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(!open);
        setQuery("");
        setSelectedIndex(0);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Handle arrow navigation and enter
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filtered[selectedIndex];
        if (selected?.href) {
          router.go(selected.href);
          setOpen(false);
          setQuery("");
        }
      }
    },
    [filtered, selectedIndex, router],
  );

  const handleSelect = useCallback(
    (href: string) => {
      router.go(href);
      setOpen(false);
      setQuery("");
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex justify-center"
      style={{
        background: "rgba(0, 0, 0, 0.8)",
        zIndex: 10000,
        paddingTop: 100,
      }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full mx-4"
        style={{
          maxWidth: 600,
          height: "fit-content",
          background: "var(--term-bg-panel)",
          border: "1px solid var(--term-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div
          className="flex items-center gap-4 p-4"
          style={{ borderBottom: "1px solid var(--term-border)" }}
        >
          <span style={{ color: "var(--term-green)" }}>{">"}</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type to search documentation..."
            autoFocus
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--term-text)",
              fontSize: 16,
              fontFamily: "inherit",
            }}
          />
          <span
            className="kbd"
            style={{ fontSize: 10, padding: "2px 6px", height: 20 }}
          >
            ESC
          </span>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="scroll-area" style={{ maxHeight: 400 }}>
          {filtered.map((doc, index) => (
            <button
              type="button"
              key={doc.href || doc.name}
              onClick={() => doc.href && handleSelect(doc.href)}
              onMouseEnter={() => setSelectedIndex(index)}
              className="btn-reset w-full command-palette-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 16px",
                color: "var(--term-text)",
                background:
                  index === selectedIndex ? "rgba(34, 197, 94, 0.1)" : "transparent",
                cursor: doc.href ? "pointer" : "default",
              }}
            >
              <IconFile size={16} style={{ color: "var(--term-cyan)" }} />
              <span>{doc.name}</span>
              {doc.href && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    color: "var(--term-text-dim)",
                  }}
                >
                  {doc.href.replace("/docs/", "")}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-4 p-3 px-4"
          style={{
            borderTop: "1px solid var(--term-border)",
            fontSize: 12,
            color: "var(--term-text-dim)",
          }}
        >
          <span>
            <span className="kbd">↑↓</span> Navigate
          </span>
          <span>
            <span className="kbd">↵</span> Open
          </span>
          <span>
            <span className="kbd">esc</span> Close
          </span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
