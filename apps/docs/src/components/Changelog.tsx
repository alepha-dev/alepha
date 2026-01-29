import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBug,
  IconGitCommit,
  IconSparkles,
} from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangelogChange } from "../../scripts/interfaces.ts";
import type { ChangelogEntry } from "../config/docs.ts";
import styles from "./Changelog.module.css";
import StatusBar from "./layout/StatusBar.tsx";

function parseMessage(message: string): { text: string; isBreaking: boolean } {
  const isBreaking = message.includes("[BREAKING]");
  const text = message.replace(/\s*\[BREAKING\]\s*/g, "").trim();
  return { text, isBreaking };
}

interface ChangelogProps {
  entries: ChangelogEntry[];
}

interface ChangeItemProps {
  change: ChangelogChange;
  itemKey: string;
  isExpanded: boolean;
  onToggle: (key: string) => void;
}

const ChangeItem = ({
  change,
  itemKey,
  isExpanded,
  onToggle,
}: ChangeItemProps) => {
  const { text, isBreaking } = parseMessage(change.message);
  const messageRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = messageRef.current;
    if (el) {
      setIsOverflowing(el.scrollWidth > el.clientWidth);
    }
  }, [text]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isOverflowing) return;
      // Don't toggle if clicking the commit link
      if ((e.target as HTMLElement).closest("a")) return;
      onToggle(itemKey);
    },
    [itemKey, onToggle, isOverflowing],
  );

  return (
    <li
      className={`${styles.item} ${isBreaking ? styles.itemBreaking : ""} ${isExpanded ? styles.itemExpanded : ""} ${isOverflowing ? styles.itemClickable : ""}`}
      onClick={handleClick}
    >
      <span className={styles.scope}>{change.scope}</span>
      <span ref={messageRef} className={styles.message}>
        {text}
      </span>
      {isBreaking && (
        <span className={styles.breaking}>
          <IconAlertTriangle size={14} />
        </span>
      )}
      {change.commit && (
        <a
          href={`https://github.com/feunard/alepha/commit/${change.commit}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.commit}
          title={`View commit ${change.commit}`}
          aria-label={`View commit ${change.commit.slice(0, 7)} on GitHub (opens in new window)`}
        >
          <IconGitCommit size={12} aria-hidden="true" />
          <span>{change.commit.slice(0, 7)}</span>
        </a>
      )}
    </li>
  );
};

const Changelog = ({ entries }: ChangelogProps) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleItem = useCallback((key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

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
        </header>

        {/* Timeline */}
        <div
          className={styles.timeline}
          role="feed"
          aria-label="Changelog entries"
        >
          {entries.map((entry, index) => (
            <article
              key={entry.version}
              className={`${styles.entry} ${index === 0 ? styles.entryLatest : ""}`}
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
                {/* Version header */}
                <div className={styles.versionHeader}>
                  <h2
                    className={styles.version}
                    id={`version-${entry.version}`}
                  >
                    v{entry.version}
                  </h2>
                  <time className={styles.date} dateTime={entry.date}>
                    {formatDate(entry.date)}
                  </time>
                </div>

                {/* Features */}
                {entry.features.length > 0 && (
                  <div className={styles.section}>
                    <h3
                      className={`${styles.sectionTitle} ${styles.sectionFeatures}`}
                    >
                      <IconSparkles size={16} />
                      Features
                    </h3>
                    <ul className={styles.list}>
                      {entry.features.map((change, i) => {
                        const key = `${entry.version}-feature-${i}`;
                        return (
                          <ChangeItem
                            key={key}
                            change={change}
                            itemKey={key}
                            isExpanded={expandedItems.has(key)}
                            onToggle={toggleItem}
                          />
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Bug Fixes */}
                {entry.fixes.length > 0 && (
                  <div className={styles.section}>
                    <h3
                      className={`${styles.sectionTitle} ${styles.sectionFixes}`}
                    >
                      <IconBug size={16} />
                      Bug Fixes
                    </h3>
                    <ul className={styles.list}>
                      {entry.fixes.map((change, i) => {
                        const key = `${entry.version}-fix-${i}`;
                        return (
                          <ChangeItem
                            key={key}
                            change={change}
                            itemKey={key}
                            isExpanded={expandedItems.has(key)}
                            onToggle={toggleItem}
                          />
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </article>
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default Changelog;
