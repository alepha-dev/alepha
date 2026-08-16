import { IconAlertTriangle, IconGitCommit } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangelogChange } from "../../scripts/interfaces.ts";
import styles from "./Changelog.module.css";

export interface ChangelogChangeItemProps {
  change: ChangelogChange;
  itemKey: string;
  isExpanded: boolean;
  onToggle: (key: string) => void;
}

/**
 * One line of a release: scope, subject, and a link to the commit.
 *
 * ⚠️ The subject is all there is. `CHANGELOG.md` stores one line per change
 * (`- **scope**: subject (\`sha\`)`) and `gen-tree.ts` parses exactly that, so
 * the commit *body* never reaches this component. Clicking therefore unclamps a
 * long subject and nothing more; the commit link is the only route to the full
 * message. Do not add an "expand to read the commit" affordance without first
 * carrying the body into the generated data.
 */
const ChangelogChangeItem = (props: ChangelogChangeItemProps) => {
  const { text, isBreaking } = parseMessage(props.change.message);
  const messageRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const { itemKey, onToggle } = props;

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
      className={`${styles.item} ${isBreaking ? styles.itemBreaking : ""} ${props.isExpanded ? styles.itemExpanded : ""} ${isOverflowing ? styles.itemClickable : ""}`}
      onClick={handleClick}
    >
      <span className={styles.scope}>{props.change.scope}</span>
      <span ref={messageRef} className={styles.message}>
        {text}
      </span>
      {isBreaking && (
        <span className={styles.breaking}>
          <IconAlertTriangle size={14} />
        </span>
      )}
      {props.change.commit && (
        <a
          href={`https://github.com/feunard/alepha/commit/${props.change.commit}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.commit}
          title={`View commit ${props.change.commit}`}
          aria-label={`View commit ${props.change.commit.slice(0, 7)} on GitHub (opens in new window)`}
        >
          <IconGitCommit size={12} aria-hidden="true" />
          <span>{props.change.commit.slice(0, 7)}</span>
        </a>
      )}
    </li>
  );
};

function parseMessage(message: string): { text: string; isBreaking: boolean } {
  const isBreaking = message.includes("[BREAKING]");
  const text = message.replace(/\s*\[BREAKING\]\s*/g, "").trim();
  return { text, isBreaking };
}

export default ChangelogChangeItem;
