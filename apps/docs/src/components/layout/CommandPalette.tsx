import { useRouter } from "@alepha/react";
import { IconFile } from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DocNode, tree } from "../../config/docs.ts";
import styles from "./CommandPalette.module.css";
import Dialog, { useDialog } from "./Dialog.tsx";

// =============================================================================
// TYPES
// =============================================================================

interface SearchableDoc {
  name: string;
  href: string;
  keywords: string[];
  keywordsJoined: string;
}

interface SearchResult {
  doc: SearchableDoc;
  matchedKeyword: string | null;
  score: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Flatten the doc tree to get all docs with hrefs */
const flattenTree = (nodes: DocNode[]): SearchableDoc[] => {
  const result: SearchableDoc[] = [];
  for (const node of nodes) {
    if (node.href) {
      result.push({
        name: node.name,
        href: node.href,
        keywords: node.keywords || [],
        keywordsJoined: (node.keywords || []).join(" "),
      });
    }
    if (node.children) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
};

/** Find the best matching keyword for display */
const findMatchedKeyword = (
  doc: SearchableDoc,
  query: string,
): string | null => {
  if (!query) return null;
  const q = query.toLowerCase();

  // Don't show keyword match if name or path already matches
  if (doc.name.toLowerCase().includes(q)) return null;
  if (doc.href.toLowerCase().includes(q)) return null;

  // Find matching keywords
  const matches = doc.keywords.filter((kw) => kw.toLowerCase().includes(q));
  if (!matches.length) return null;

  // Return shortest match (most specific)
  return matches.sort((a, b) => a.length - b.length)[0];
};

// =============================================================================
// FUSE.JS CONFIGURATION
// =============================================================================

const FUSE_OPTIONS: IFuseOptions<SearchableDoc> = {
  keys: [
    { name: "name", weight: 1.0 },
    { name: "keywords", weight: 0.7 },
    { name: "keywordsJoined", weight: 0.5 },
    { name: "href", weight: 0.3 },
  ],
  threshold: 0.4, // 0 = exact match, 1 = match anything
  distance: 100,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

// =============================================================================
// COMMAND PALETTE COMPONENT
// =============================================================================

const CommandPalette = () => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const resultsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { open, openDialog, closeDialog, dialogProps } = useDialog();

  // Flatten docs and create Fuse index
  const allDocs = useMemo(() => flattenTree(tree), []);
  const fuse = useMemo(() => new Fuse(allDocs, FUSE_OPTIONS), [allDocs]);

  // Search results with scoring
  const results: SearchResult[] = useMemo(() => {
    if (!query.trim()) {
      // Show first 10 docs when no query
      return allDocs.slice(0, 10).map((doc) => ({
        doc,
        matchedKeyword: null,
        score: 0,
      }));
    }

    // Fuzzy search with Fuse.js
    const fuseResults = fuse.search(query, { limit: 20 });

    return fuseResults.map((result) => ({
      doc: result.item,
      matchedKeyword: findMatchedKeyword(result.item, query),
      score: result.score ?? 1,
    }));
  }, [query, allDocs, fuse]);

  // Reset selection when query changes
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

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure dialog is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Global keyboard shortcut to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) {
          closeDialog();
        } else {
          setQuery("");
          setSelectedIndex(0);
          openDialog();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, openDialog, closeDialog]);

  // Handle navigation in results
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected?.doc.href) {
          router.go(selected.doc.href);
          closeDialog();
        }
      }
    },
    [results, selectedIndex, router, closeDialog],
  );

  // Handle click on result
  const handleSelect = useCallback(
    (href: string) => {
      router.go(href);
      closeDialog();
    },
    [router, closeDialog],
  );

  return (
    <Dialog
      {...dialogProps}
      className={styles.container}
      overlayPadding="80px 16px 20px"
    >
      {/* Input */}
      <div className={styles.inputSection}>
        <span className={styles.prompt}>{">"}</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Type to search documentation..."
          className={styles.input}
        />
        <span className={`kbd ${styles.escBadge}`}>ESC</span>
      </div>

      {/* Results */}
      <div ref={resultsRef} className={styles.results}>
        {results.map((result, index) => (
          <button
            type="button"
            key={result.doc.href}
            onClick={() => handleSelect(result.doc.href)}
            onMouseEnter={() => setSelectedIndex(index)}
            className={`${styles.item} ${index === selectedIndex ? styles.itemSelected : ""}`}
          >
            <IconFile size={16} className={styles.itemIcon} />
            <span className="truncate">{result.doc.name}</span>
            {result.matchedKeyword && (
              <span className={styles.matchedKeyword}>
                {result.matchedKeyword}
              </span>
            )}
            <span className={styles.itemPath}>
              {result.doc.href.replace("/docs/", "")}
            </span>
          </button>
        ))}
        {results.length === 0 && query && (
          <div className={styles.noResults}>No results found</div>
        )}
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
    </Dialog>
  );
};

export default CommandPalette;
