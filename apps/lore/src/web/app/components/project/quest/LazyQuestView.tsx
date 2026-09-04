import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import { lazy, Suspense } from "react";

import type { QuestViewProps } from "./QuestView.tsx";

/**
 * `QuestView`, behind a chunk boundary.
 *
 * The quest page is the only place that should decide when `QuestView.tsx`
 * is downloaded. It is `lazy` in the router, but the kanban card and the
 * questline dialog both imported it statically, and a module that is both
 * lazily routed and statically imported is folded into a shared chunk. Vite
 * then writes no manifest entry for it, so the SSR preload lookup for the
 * quest route resolved to nothing and one of Lore's most visited pages
 * shipped with zero page preloads. Rolldown warns about none of this.
 *
 * Importing through here keeps all three sites dynamic, which is what gives
 * `QuestView` a chunk of its own again. Accepting the shared chunk instead
 * would have been resolvable but wrong: its closure is 101 chunks (1373 KB),
 * everything `ProjectEpic` happens to share with the card, rather than what
 * the quest page needs.
 *
 * The type import is erased, so it costs no edge.
 */
const loadQuestView = () => import("./QuestView.tsx");

const Inner = lazy(loadQuestView);

/**
 * Warm the chunk before anything renders it.
 *
 * Both call sites open on a user gesture from a surface that is already
 * loaded (a board, a map), so fetching the chunk when that surface mounts
 * turns the boundary into something nobody sees. Idempotent: repeat calls
 * join the same in-flight promise.
 */
export const preloadQuestView = () => {
  void loadQuestView();
};

const LazyQuestView = (props: QuestViewProps) => {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="min-h-0 flex-1" />
        </div>
      }
    >
      <Inner {...props} />
    </Suspense>
  );
};

export default LazyQuestView;
