import { lazy, Suspense, useSyncExternalStore } from "react";
import type { MarkdownEditorInnerProps } from "./MarkdownEditorInner.tsx";

export type MarkdownEditorProps = MarkdownEditorInnerProps;

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
const Inner = lazy(() => import("./MarkdownEditorInner.tsx"));

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

  const placeholder = (
    <div
      className="border-input bg-background min-h-64 rounded-md border"
      style={props.minHeight ? { minHeight: props.minHeight } : undefined}
    />
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
