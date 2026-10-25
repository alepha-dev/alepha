import { lazy, Suspense } from "react";

import type { ProjectActivityPageProps } from "./ProjectActivityPage.tsx";

/**
 * `ProjectActivityPage`, behind a chunk boundary, for a page that renders it
 * inline: Work's epic page has an Activity tab (#E75, #Q2611).
 *
 * The page is `lazy` in `CoreRouter`. Exported from `@lore/core/web` as a
 * value, a module that is both statically and dynamically imported is hoisted
 * into the static graph: the activity table and the whole form stack behind
 * it landed in every Worker's boot. Importing through here keeps both sites
 * dynamic. The type import is erased, so it costs no edge.
 */
const Inner = lazy(() => import("./ProjectActivityPage.tsx"));

const LazyProjectActivityPage = (props: ProjectActivityPageProps) => (
  <Suspense fallback={null}>
    <Inner {...props} />
  </Suspense>
);

export default LazyProjectActivityPage;
