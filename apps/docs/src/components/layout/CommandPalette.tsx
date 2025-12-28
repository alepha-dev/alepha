import { useRouter } from "@alepha/react";
import { IconFile } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DocNode, tree } from "../../config/docs.ts";
import styles from "./CommandPalette.module.css";

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

  const allDocs = flattenTree(tree);

  const filtered = query
    ? allDocs.filter(
        (doc) =>
          doc.name.toLowerCase().includes(query.toLowerCase()) ||
          doc.href?.toLowerCase().includes(query.toLowerCase()),
      )
    : allDocs.slice(0, 10);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.children[
        selectedIndex
      ] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

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
    <div className={styles.overlay} onClick={() => setOpen(false)}>
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* Input */}
        <div className={styles.inputSection}>
          <span className={styles.prompt}>{">"}</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type to search documentation..."
            autoFocus
            className={styles.input}
          />
          <span className={`kbd ${styles.escBadge}`}>ESC</span>
        </div>

        {/* Results */}
        <div ref={resultsRef} className={styles.results}>
          {filtered.map((doc, index) => (
            <button
              type="button"
              key={doc.href || doc.name}
              onClick={() => doc.href && handleSelect(doc.href)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`${styles.item} ${index === selectedIndex ? styles.itemSelected : ""}`}
            >
              <IconFile size={16} className={styles.itemIcon} />
              <span className="truncate">{doc.name}</span>
              <span className={styles.itemPath}>
                {doc.href?.replace("/docs/", "")}
              </span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
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
