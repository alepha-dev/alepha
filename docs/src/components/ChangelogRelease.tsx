import { IconFolder, IconStack2 } from "@tabler/icons-react";

import type { ChangelogEntry } from "../config/docs.ts";
import ChangelogReleaseSection from "./ChangelogReleaseSection.tsx";

import styles from "./Changelog.module.css";

export interface ChangelogReleaseProps {
  entry: ChangelogEntry;
  isLatest: boolean;
  /**
   * Whether its changes are shown. Only the latest release is, by default
   * (#Q4011): the others are a header with their change count.
   */
  open: boolean;
  onOpenChange: (version: string, open: boolean) => void;
  expandedItems: Set<string>;
  onToggleItem: (key: string) => void;
}

/**
 * One release on the timeline, with its changes.
 *
 * Collapsible again since #Q4011: ten releases, every one open, were 1,754
 * changes and a page 92,000 px tall at 1920x868, a scrollbar with nothing to
 * hold. A shut release is its header and its change count, a native
 * `<details>`: its changes stay in the prerendered HTML, so the scope filter
 * and the hydration pass see the same page, and opening one needs no script.
 */
const ChangelogRelease = (props: ChangelogReleaseProps) => {
  const entry = props.entry;
  const count = entry.groups.reduce(
    (sum, group) => sum + group.changes.length,
    0,
  );

  return (
    <article
      className={`${styles.entry} ${props.isLatest ? styles.entryLatest : ""}`}
      aria-labelledby={`version-${entry.version}`}
    >
      <div className={styles.entryCircle} aria-hidden="true" />
      <div
        className={`${styles.entryCircle} ${styles.entryCircleRight}`}
        aria-hidden="true"
      />

      {/* Timeline node */}
      <div className={styles.node} aria-hidden="true">
        <div className={styles.nodeDot} />
        <div className={styles.nodeLine} />
      </div>

      {/* Content */}
      <details
        className={styles.content}
        open={props.open}
        onToggle={(event) =>
          props.onOpenChange(entry.version, event.currentTarget.open)
        }
      >
        <summary className={styles.versionHeader}>
          <h2 className={styles.version} id={`version-${entry.version}`}>
            v{entry.version}
          </h2>
          <time className={styles.date} dateTime={entry.date}>
            {formatDate(entry.date)}
          </time>
          <span className={styles.count}>
            {count} {count === 1 ? "change" : "changes"}
          </span>
        </summary>

        {/* The Lore release's own grouping (#Q3638): its epics, then the
            quests of each area that belong to no epic. */}
        {/* Keyed by kind and name, which `LoreChangelog` makes unique within
            a release: a duplicate key leaves a stale section on screen once
            the scope filter removes one of the pair. */}
        {entry.groups.map((group) => (
          <ChangelogReleaseSection
            key={`${group.kind}-${group.name}`}
            title={group.name}
            titleClassName={
              group.kind === "epic" ? styles.sectionEpic : styles.sectionArea
            }
            icon={
              group.kind === "epic" ? (
                <IconStack2 size={16} />
              ) : (
                <IconFolder size={16} />
              )
            }
            changes={group.changes}
            keyPrefix={`${entry.version}-${group.kind}-${group.name}`}
            expandedItems={props.expandedItems}
            onToggleItem={props.onToggleItem}
          />
        ))}
      </details>
    </article>
  );
};

// A release date is a calendar day ("2026-10-28"), not an instant: format it
// in UTC, or a visitor west of UTC hydrates the previous day over the
// prerendered one (React #418).
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default ChangelogRelease;
