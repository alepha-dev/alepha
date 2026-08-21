import { IconArrowLeft } from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import { useCallback, useState } from "react";

import type { ChangelogEntry } from "../config/docs.ts";
import ChangelogRelease from "./ChangelogRelease.tsx";
import StatusBar from "./layout/StatusBar.tsx";

import styles from "./Changelog.module.css";

export interface ChangelogProps {
  entries: ChangelogEntry[];
}

/**
 * The full release history on one route.
 *
 * Releases are collapsed by default and mount their change lists only when
 * open. Rendering every release in full put the entire history on the page at
 * once, which made it enormous to scroll and to download.
 */
const Changelog = (props: ChangelogProps) => {
  const [openVersions, setOpenVersions] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleItem = useCallback((key: string) => {
    setExpandedItems((prev) => toggled(prev, key));
  }, []);

  const toggleVersion = useCallback((version: string) => {
    setOpenVersions((prev) => toggled(prev, version));
  }, []);

  const allOpen = openVersions.size === props.entries.length;

  const toggleAll = useCallback(() => {
    setOpenVersions((prev) =>
      prev.size === props.entries.length
        ? new Set()
        : new Set(props.entries.map((entry) => entry.version)),
    );
  }, [props.entries]);

  return (
    <div className="terminal-page">
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <Link href="/" className={styles.back} aria-label="Back to Home">
            <IconArrowLeft size={16} aria-hidden="true" />
            <span>Back to Home</span>
          </Link>
          <h1 className={styles.title}>
            Changelog
            <small aria-hidden="true">.md</small>
          </h1>
          <button
            type="button"
            className={styles.expandAll}
            onClick={toggleAll}
            aria-expanded={allOpen}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </header>

        {/* Timeline */}
        <div
          className={styles.timeline}
          role="feed"
          aria-label="Changelog entries"
        >
          {props.entries.map((entry, index) => (
            <ChangelogRelease
              key={entry.version}
              entry={entry}
              isLatest={index === 0}
              isOpen={openVersions.has(entry.version)}
              onToggle={toggleVersion}
              expandedItems={expandedItems}
              onToggleItem={toggleItem}
            />
          ))}

          {/* Timeline end */}
          <div className={styles.end} aria-hidden="true">
            <div className={styles.endDot} />
            <span className={styles.endText}>The Beginning</span>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>
    </div>
  );
};

function toggled(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export default Changelog;
