import {
  type ChangelogScopeGroup,
  changelogScopeGroups,
} from "../config/changelogScopes.ts";

import styles from "./Changelog.module.css";

export interface ChangelogScopeFilterProps {
  /**
   * The raw `?scope=` value, or undefined for an unfiltered page.
   */
  scope: string | undefined;
  onSelect: (scope: string | undefined) => void;
}

/**
 * The six buttons above the timeline, each writing its group id into
 * `?scope=`. `All` writes nothing and clears the param.
 *
 * `?scope=` also accepts raw scope tokens that name no group, so a URL can
 * always say something the buttons cannot. When it does, a seventh button
 * appears carrying that value, so the page never filters silently.
 */
const ChangelogScopeFilter = (props: ChangelogScopeFilterProps) => {
  const active = props.scope?.trim().toLowerCase() || "all";
  const isCustom = !changelogScopeGroups.some((group) => group.id === active);
  const groups: ChangelogScopeGroup[] = isCustom
    ? [...changelogScopeGroups, { id: active, label: active }]
    : changelogScopeGroups;

  return (
    <div
      className={styles.filter}
      role="group"
      aria-label="Filter changes by scope"
    >
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          className={`${styles.filterButton} ${active === group.id ? styles.filterButtonActive : ""}`}
          aria-pressed={active === group.id}
          onClick={() =>
            props.onSelect(group.id === "all" ? undefined : group.id)
          }
        >
          {group.label}
        </button>
      ))}
    </div>
  );
};

export default ChangelogScopeFilter;
