import { IconFile } from "@tabler/icons-react";
import { useRouter } from "alepha/react/router";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { tree } from "../../config/docs.ts";
import {
  findMatchedKeyword,
  flattenTree,
  type SearchableDoc,
} from "../../helpers/search.ts";
import Dialog, { useDialog } from "./Dialog.tsx";

import styles from "./CommandPalette.module.css";

// =============================================================================
// TYPES
// =============================================================================

interface SearchResult {
  doc: SearchableDoc;
  matchedKeyword: string | null;
  score: number;
}

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

  // Reset selection when query changes. During render, so the highlight never
  // sits on a stale row for a frame.
  const [selectionQuery, setSelectionQuery] = useState(query);
  if (query !== selectionQuery) {
    setSelectionQuery(query);
    setSelectedIndex(0);
  }

  // Scroll selected item into view
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
          void router.push(selected.doc.href);
          closeDialog();
        }
      }
    },
    [results, selectedIndex, router, closeDialog],
  );

  // Handle click on result
  const handleSelect = useCallback(
    (href: string) => {
      void router.push(href);
      closeDialog();
    },
    [router, closeDialog],
  );

  return (
    <Dialog
      {...dialogProps}
      className={styles.container}
      overlayPadding="80px 16px 20px"
      ariaLabel="Search documentation"
    >
      {/* Input */}
      <div className={styles.inputSection}>
        <span className={styles.prompt} aria-hidden="true">
          {">"}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Type to search documentation..."
          aria-label="Search documentation"
          aria-autocomplete="list"
          aria-controls="command-palette-results"
          aria-activedescendant={
            results[selectedIndex] ? `result-${selectedIndex}` : undefined
          }
          role="combobox"
          aria-expanded={results.length > 0}
          aria-haspopup="listbox"
          className={styles.input}
        />
        <span className={`kbd ${styles.escBadge}`} aria-hidden="true">
          ESC
        </span>
      </div>

      {/* Results */}
      <div
        ref={resultsRef}
        id="command-palette-results"
        role="listbox"
        aria-label="Search results"
        className={styles.results}
      >
        {results.map((result, index) => (
          <button
            type="button"
            key={result.doc.href}
            id={`result-${index}`}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => handleSelect(result.doc.href)}
            onMouseEnter={() => setSelectedIndex(index)}
            className={`${styles.item} ${index === selectedIndex ? styles.itemSelected : ""}`}
          >
            <IconFile
              size={16}
              className={styles.itemIcon}
              aria-hidden="true"
            />
            <span className="truncate">{result.doc.name}</span>
            {result.matchedKeyword && (
              <span className={styles.matchedKeyword}>
                {result.matchedKeyword}
              </span>
            )}
            <span
              className={styles.itemPath}
              aria-label={`Path: ${result.doc.href.replace("/docs/", "")}`}
            >
              {result.doc.href.replace("/docs/", "")}
            </span>
          </button>
        ))}
        {results.length === 0 && query && (
          <div className={styles.noResults} role="status" aria-live="polite">
            No results found
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer} aria-hidden="true">
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
