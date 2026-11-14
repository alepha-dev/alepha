import { IconAlertTriangle } from "@tabler/icons-react";
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
 * One line of a release: the quest's area, and its title.
 *
 * ⚠️ The title is all there is. The page is built from the Lore release
 * (#Q3638), which lists each quest by title, and a quest's number or link is
 * a planning record that stays off user documentation. Clicking therefore
 * unclamps a long title and nothing more.
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

  const handleClick = useCallback(() => {
    if (!isOverflowing) return;
    onToggle(itemKey);
  }, [itemKey, onToggle, isOverflowing]);

  return (
    // The row expands truncated text on click; it is a disclosure for content
    // that is already fully present to a screen reader, so there is nothing
    // keyboard-only users lose.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
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
    </li>
  );
};

function parseMessage(message: string): { text: string; isBreaking: boolean } {
  const isBreaking = message.includes("[BREAKING]");
  const text = message.replace(/\s*\[BREAKING\]\s*/g, "").trim();
  return { text, isBreaking };
}

export default ChangelogChangeItem;
