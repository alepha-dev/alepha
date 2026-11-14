import { IconFolder, IconStack2 } from "@tabler/icons-react";

import type { ChangelogEntry } from "../config/docs.ts";
import ChangelogReleaseSection from "./ChangelogReleaseSection.tsx";

import styles from "./Changelog.module.css";

export interface ChangelogReleaseProps {
  entry: ChangelogEntry;
  isLatest: boolean;
  expandedItems: Set<string>;
  onToggleItem: (key: string) => void;
}

/**
 * One release on the timeline, with its changes.
 *
 * Releases were collapsible for one release cycle, to keep the whole history
 * off a single page. The page now carries ten releases rather than all of
 * them, which is the same saving without a page of shut drawers to open.
 */
const ChangelogRelease = (props: ChangelogReleaseProps) => {
  const entry = props.entry;

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
      <div className={styles.content}>
        <div className={styles.versionHeader}>
          <h2 className={styles.version} id={`version-${entry.version}`}>
            v{entry.version}
          </h2>
          <time className={styles.date} dateTime={entry.date}>
            {formatDate(entry.date)}
          </time>
        </div>

        {/* The Lore release's own grouping (#Q3638): its epics, then the
            quests of each area that belong to no epic. */}
        {entry.groups.map((group, index) => (
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
            keyPrefix={`${entry.version}-${index}`}
            expandedItems={props.expandedItems}
            onToggleItem={props.onToggleItem}
          />
        ))}
      </div>
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
