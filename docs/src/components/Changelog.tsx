import { IconArrowLeft } from "@tabler/icons-react";
import { Link, useQueryParams } from "alepha/react/router";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { changelogScopeQuerySchema } from "../config/changelogScopeQuerySchema.ts";
import {
  matchesChangelogScope,
  parseChangelogScope,
} from "../config/changelogScopes.ts";
import type { ChangelogEntry } from "../config/docs.ts";
import ChangelogIndex from "./ChangelogIndex.tsx";
import ChangelogRelease from "./ChangelogRelease.tsx";
import ChangelogScopeFilter from "./ChangelogScopeFilter.tsx";
import StatusBar from "./layout/StatusBar.tsx";

import styles from "./Changelog.module.css";

export interface ChangelogProps {
  entries: ChangelogEntry[];
}

/**
 * How many releases the page carries. Roughly a year of them.
 *
 * The limit is the whole reason the releases can be open again. The full
 * history is 97 releases and grows every fortnight, and rendering all of it
 * was what made collapsing them look necessary. A fixed window does not grow.
 *
 * It is not small: ten releases is 1109 changes and 886 KB of prerendered
 * HTML, 49 KB of it over the wire once brotli has had it, which is what the
 * edge actually serves. Adding an eleventh is a decision to be taken with that
 * measured again, not assumed.
 */
const RELEASE_LIMIT = 10;

/**
 * Every release, older ones included. Each GitHub Release carries the same
 * notes as its Lore release (#Q3640), so it is where the history continues
 * past the page's window.
 */
const CHANGELOG_URL = "https://github.com/alepha-dev/alepha/releases";

/**
 * The recent release history on one route: the latest release open, the
 * others shut to their header and change count, and an index above them that
 * jumps to any one and opens it (#Q4011).
 *
 * `?scope=` narrows it: a group id from the buttons (`framework`, `cli`, `ui`,
 * `lore`, `bay`) or a raw comma-separated list of scope tokens. A release with
 * nothing left after filtering drops off the timeline rather than showing an
 * empty card.
 */
const Changelog = (props: ChangelogProps) => {
  const [params, setParams] = useQueryParams(changelogScopeQuerySchema, {
    format: "querystring",
  });
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  /**
   * Which releases the reader opened or shut, by version. Unset, a release
   * reads its default: the latest alone is open on the page as prerendered,
   * and every release a scope leaves is open, since the scope already
   * narrowed the page to what the reader asked for. Picking a scope starts
   * over from those defaults.
   */
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());

  /**
   * ⚠️ The filter is applied only after hydration, and this is why.
   *
   * Every route here is prerendered (`static: true`), and a static host serves
   * one file per path: `/changelog?scope=ui` is answered with the HTML built
   * for `/changelog`, which is unfiltered. Reading the param during the first
   * client render would then disagree with that HTML and hydration would fail
   * (React #418), which the `hydration` e2e suite treats as a failure. So the
   * first render reproduces the prerender, and the filter arrives one render
   * later - visible only on a deep link that already carries a scope.
   *
   * `useSyncExternalStore` rather than a `useState` + `useEffect` mount flag,
   * the same way `ClientOnly` does it: it reports `false` for both the server
   * render and the hydration pass, then `true`.
   */
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const scope = hydrated ? params.scope : undefined;

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

  const onSelect = useCallback(
    (next: string | undefined) => {
      setToggled(new Map());
      setParams({ scope: next });
    },
    [setParams],
  );

  const releases = useMemo(() => {
    const recent = props.entries.slice(0, RELEASE_LIMIT);
    const tokens = parseChangelogScope(scope);
    if (tokens.length === 0) return recent;

    // A group with nothing left drops off its release, and a release with no
    // group left drops off the timeline.
    return recent
      .map((entry) => ({
        ...entry,
        groups: entry.groups
          .map((group) => ({
            ...group,
            changes: group.changes.filter((change) =>
              matchesChangelogScope(change.scope, tokens),
            ),
          }))
          .filter((group) => group.changes.length > 0),
      }))
      .filter((entry) => entry.groups.length > 0);
  }, [props.entries, scope]);

  const latest = props.entries[0]?.version;

  const isOpen = (version: string) =>
    toggled.get(version) ?? (scope ? true : version === latest);

  const onOpenChange = useCallback((version: string, open: boolean) => {
    setToggled((prev) => {
      if (prev.get(version) === open) return prev;
      return new Map(prev).set(version, open);
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
          <ChangelogScopeFilter scope={scope} onSelect={onSelect} />
          <ChangelogIndex
            entries={releases}
            onJump={(version) => onOpenChange(version, true)}
          />
        </header>

        {/* Timeline */}
        <div
          className={styles.timeline}
          role="feed"
          aria-label="Changelog entries"
        >
          {releases.map((entry) => (
            <ChangelogRelease
              key={entry.version}
              entry={entry}
              isLatest={entry.version === latest}
              open={isOpen(entry.version)}
              onOpenChange={onOpenChange}
              expandedItems={expandedItems}
              onToggleItem={toggleItem}
            />
          ))}

          {releases.length === 0 && (
            <p className={styles.empty}>
              No change in the last {RELEASE_LIMIT} releases matches{" "}
              <code>{scope}</code>.
            </p>
          )}

          {/* Timeline end */}
          <div className={styles.end}>
            <div className={styles.endDot} aria-hidden="true" />
            <a
              className={styles.endLink}
              href={CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Older releases on GitHub
            </a>
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

export default Changelog;
