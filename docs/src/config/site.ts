/**
 * The site that documents the release.
 */
export const RELEASE_SITE = "https://alepha.dev";

/**
 * The site that documents `main`, for projects that vendor Alepha (#Q3028).
 */
export const LATEST_SITE = "https://latest.alepha.dev";

/**
 * Whether this build is latest.alepha.dev.
 *
 * Read from Vite's env, not `PUBLIC_URL`, because the prerender and the client
 * must agree: `import.meta.env` reaches both, so the banner hydrates cleanly.
 */
export const isLatestSite = (): boolean =>
  import.meta.env?.VITE_DOCS_SITE === "latest";
