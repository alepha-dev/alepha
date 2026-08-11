import { lazy, type ReactNode, Suspense, useSyncExternalStore } from "react";
import type { MarkdownEditorInnerProps } from "./MarkdownEditorInner.tsx";

export interface MarkdownEditorProps extends MarkdownEditorInnerProps {
  /**
   * Rendered alongside the body placeholder for exactly as long as the editor
   * is not mounted — pre-hydration and while the lazy chunk resolves.
   *
   * `renderToolbar` output only exists once the realm does, so any chrome a
   * caller portals out of the editor is absent until then. Callers that put
   * such chrome somewhere structural (Lore's folio menubar sits above all three
   * panes) can pass a stand-in here and let Suspense do the swap: no readiness
   * flag to thread, no window where both are mounted.
   */
  loadingChrome?: ReactNode;
}

/**
 * Lore's markdown editor — a lazy, client-only boundary around MDXEditor.
 *
 * The MDXEditor bundle (Lexical + CodeMirror) is heavy and browser-only,
 * so it must never be evaluated during SSR and never land in the initial
 * chunk: the import happens through `lazy()` and the component renders a
 * placeholder until hydration.
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
  const { loadingChrome, ...innerProps } = props;
  const placeholder = (
    <>
      {loadingChrome}
      <div
        className={
          props.variant === "bare"
            ? "min-h-64"
            : "border-input bg-background min-h-64 rounded-md border"
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
      <Inner {...innerProps} />
    </Suspense>
  );
};

export default MarkdownEditor;
