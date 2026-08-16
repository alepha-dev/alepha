import type { ChangelogChange } from "../../scripts/interfaces.ts";
import styles from "./Changelog.module.css";
import ChangelogChangeItem from "./ChangelogChangeItem.tsx";

export interface ChangelogReleaseSectionProps {
  title: string;
  titleClassName: string;
  icon: React.ReactNode;
  changes: ChangelogChange[];
  keyPrefix: string;
  expandedItems: Set<string>;
  onToggleItem: (key: string) => void;
}

/**
 * One titled group of changes inside an open release (Features, Bug Fixes).
 */
const ChangelogReleaseSection = (props: ChangelogReleaseSectionProps) => (
  <div className={styles.section}>
    <h3 className={`${styles.sectionTitle} ${props.titleClassName}`}>
      {props.icon}
      {props.title}
    </h3>
    <ul className={styles.list}>
      {props.changes.map((change, i) => {
        const key = `${props.keyPrefix}-${i}`;
        return (
          <ChangelogChangeItem
            key={key}
            change={change}
            itemKey={key}
            isExpanded={props.expandedItems.has(key)}
            onToggle={props.onToggleItem}
          />
        );
      })}
    </ul>
  </div>
);

export default ChangelogReleaseSection;
