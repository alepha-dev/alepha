import { IconArrowLeft } from "@tabler/icons-react";
import { Link, useQueryParams } from "alepha/react/router";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { changelogScopeQuerySchema } from "../config/changelogScopeQuerySchema.ts";
import {
  matchesChangelogScope,
  parseChangelogScope,
} from "../config/changelogScopes.ts";
import type { ChangelogEntry } from "../config/docs.ts";
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

const CHANGELOG_URL =
  "https://github.com/alepha-dev/alepha/blob/main/CHANGELOG.md";

/**
 * The recent release history on one route, every release open.
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
    (next: string | undefined) => setParams({ scope: next }),
    [setParams],
  );

  const releases = useMemo(() => {
    const recent = props.entries.slice(0, RELEASE_LIMIT);
    const tokens = parseChangelogScope(scope);
    if (tokens.length === 0) return recent;

    return recent
      .map((entry) => ({
        ...entry,
        features: entry.features.filter((change) =>
          matchesChangelogScope(change.scope, tokens),
        ),
        fixes: entry.fixes.filter((change) =>
          matchesChangelogScope(change.scope, tokens),
        ),
      }))
      .filter((entry) => entry.features.length + entry.fixes.length > 0);
  }, [props.entries, scope]);

  const latest = props.entries[0]?.version;

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
