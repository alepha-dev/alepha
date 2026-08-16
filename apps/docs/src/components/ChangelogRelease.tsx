import { IconBug, IconChevronRight, IconSparkles } from "@tabler/icons-react";
import { useCallback } from "react";
import type { ChangelogEntry } from "../config/docs.ts";
import styles from "./Changelog.module.css";
import ChangelogReleaseSection from "./ChangelogReleaseSection.tsx";

export interface ChangelogReleaseProps {
  entry: ChangelogEntry;
  isLatest: boolean;
  isOpen: boolean;
  onToggle: (version: string) => void;
  expandedItems: Set<string>;
  onToggleItem: (key: string) => void;
}

/**
 * One release on the timeline, collapsed by default.
 *
 * Every release used to render its full list of changes, which made the page
 * enormous: the whole history is on one route, and a single release routinely
 * carries 30+ entries. The header is now the control, and the body mounts only
 * while open, so a collapsed release costs one row instead of a hundred.
 */
const ChangelogRelease = (props: ChangelogReleaseProps) => {
  const { entry, onToggle } = props;
  const featureCount = entry.features.length;
  const fixCount = entry.fixes.length;
  const bodyId = `release-body-${entry.version}`;

  const handleToggle = useCallback(() => {
    onToggle(entry.version);
  }, [entry.version, onToggle]);

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
        <button
          type="button"
          className={`${styles.versionHeader} ${props.isOpen ? styles.versionHeaderOpen : ""}`}
          onClick={handleToggle}
          aria-expanded={props.isOpen}
          aria-controls={bodyId}
        >
          <IconChevronRight
            size={16}
            className={styles.chevron}
            aria-hidden="true"
          />
          <h2 className={styles.version} id={`version-${entry.version}`}>
            v{entry.version}
          </h2>
          <time className={styles.date} dateTime={entry.date}>
            {formatDate(entry.date)}
          </time>
          <span className={styles.summary}>
            {summarize(featureCount, fixCount)}
          </span>
        </button>

        {props.isOpen && (
          <div id={bodyId}>
            {featureCount > 0 && (
              <ChangelogReleaseSection
                title="Features"
                titleClassName={styles.sectionFeatures}
                icon={<IconSparkles size={16} />}
                changes={entry.features}
                keyPrefix={`${entry.version}-feature`}
                expandedItems={props.expandedItems}
                onToggleItem={props.onToggleItem}
              />
            )}
            {fixCount > 0 && (
              <ChangelogReleaseSection
                title="Bug Fixes"
                titleClassName={styles.sectionFixes}
                icon={<IconBug size={16} />}
                changes={entry.fixes}
                keyPrefix={`${entry.version}-fix`}
                expandedItems={props.expandedItems}
                onToggleItem={props.onToggleItem}
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
};

/**
 * The collapsed header's whole payload, so a shut release still says how much
 * is inside it. Uses a middle dot rather than an em dash, which is banned from
 * user-facing strings.
 */
function summarize(featureCount: number, fixCount: number): string {
  const parts: string[] = [];
  if (featureCount > 0) {
    parts.push(
      `${featureCount} ${featureCount === 1 ? "feature" : "features"}`,
    );
  }
  if (fixCount > 0) {
    parts.push(`${fixCount} ${fixCount === 1 ? "fix" : "fixes"}`);
  }
  return parts.join(" · ");
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default ChangelogRelease;
