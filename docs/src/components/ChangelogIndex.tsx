import type { ChangelogEntry } from "../config/docs.ts";

import styles from "./Changelog.module.css";

export interface ChangelogIndexProps {
  entries: ChangelogEntry[];
  /**
   * Called with the release a link jumps to, which opens it: the anchor
   * scrolls to its header, and the changes are what the reader came for.
   */
  onJump: (version: string) => void;
}

/**
 * Every release on the page as a link to its header (#Q4011), so the one
 * wanted is a click away rather than a scroll through the others. Plain
 * anchors: the list works before hydration and with no script at all.
 */
const ChangelogIndex = (props: ChangelogIndexProps) => {
  if (props.entries.length < 2) return null;
  return (
    <nav className={styles.index} aria-label="Releases">
      {props.entries.map((entry) => (
        <a
          key={entry.version}
          className={styles.indexLink}
          href={`#version-${entry.version}`}
          onClick={() => props.onJump(entry.version)}
        >
          v{entry.version}
        </a>
      ))}
    </nav>
  );
};

export default ChangelogIndex;
