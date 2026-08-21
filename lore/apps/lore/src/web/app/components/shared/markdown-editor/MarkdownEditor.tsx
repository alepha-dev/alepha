import { lazy, Suspense, useSyncExternalStore } from "react";

import type { MarkdownEditorInnerProps } from "./MarkdownEditorInner.tsx";

export type MarkdownEditorProps = MarkdownEditorInnerProps;

/**
 * Lore's markdown surface — a lazy, client-only boundary around the
 * view/edit toggle.
 *
 * CodeMirror is browser-only, so it must never be evaluated during SSR and
 * never land in the initial chunk: the import happens through `lazy()` and
 * the component renders a placeholder until hydration. That was true of the
 * MDXEditor this replaced and is just as true now — the bundle is far
 * smaller, but `document` is still required at module scope.
 *
 * Markdown stays the single source of truth (folios are stored, encrypted
 * and MCP-served as markdown strings) — this is only a view over it.
 */
const loadInner = () => import("./MarkdownEditorInner.tsx");

const Inner = lazy(loadInner);

/**
 * Warm the editor chunk before anything renders it.
 *
 * `lazy()` starts its import on first render, which is the moment the user is
 * already waiting — a cold chunk is a visible pause on the first folio opened
 * per session. Calling the same dynamic import early populates the module
 * cache, so `lazy` resolves from it and the wait is gone. Idempotent: repeat
 * calls hit the same in-flight promise.
 *
 * This shrinks the window; it does not close it. A cold cache or a slow link
 * reopens it, which is why the loading state still has to be correct on its
 * own.
 */
export const preloadMarkdownEditor = () => {
  void loadInner();
};

const emptySubscribe = () => () => {};

const MarkdownEditor = (props: MarkdownEditorProps) => {
  // `useSyncExternalStore` is the React-blessed hydration-safe browser
  // check: the server snapshot says "not mounted", the client snapshot
  // flips after hydration without a mismatch warning.
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  // The placeholder has to reserve the same shape the real editor will
  // take, frame included — a bare editor that flashes a bordered box
  // before hydration is a visible jump on every folio open.
  const placeholder = (
    <>
      <div
        className={
          props.variant === "bare"
            ? "lore-md-view min-h-64"
            : "lore-md-view border-input dark:bg-input/30 min-h-64 rounded-lg border bg-transparent p-3"
        }
        style={props.minHeight ? { minHeight: props.minHeight } : undefined}
      />
    </>
  );

  if (!isClient) {
    return placeholder;
  }

  return (
    <Suspense fallback={placeholder}>
      <Inner {...props} />
    </Suspense>
  );
};

export default MarkdownEditor;
