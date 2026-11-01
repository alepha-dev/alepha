import { useRouterState } from "alepha/react/router";

import { isLatestSite, RELEASE_SITE } from "../../config/site.ts";

/**
 * Tells a reader of latest.alepha.dev that these pages describe `main`, and
 * links to the same page on the released site.
 */
const LatestBanner = () => {
  const state = useRouterState();

  if (!isLatestSite()) {
    return null;
  }

  return (
    <div
      role="note"
      className="px-4 py-1 text-center"
      style={{
        background: "var(--color-bg)",
        borderBottom: "1px solid var(--color-border)",
        color: "var(--color-text-muted)",
        fontSize: 12,
      }}
    >
      These docs follow <code>main</code> and may describe unreleased work.
      Installed from npm?{" "}
      <a href={`${RELEASE_SITE}${state.url.pathname}`}>Read the release docs</a>
      .
    </div>
  );
};

export default LatestBanner;
