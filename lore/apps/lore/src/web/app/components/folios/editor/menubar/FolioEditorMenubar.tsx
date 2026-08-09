import { type ReactElement, useEffect } from "react";
import type { FolioActionHandlers } from "../useFolioActions.ts";
import FolioMenubar, { type FolioMenubarProps } from "./FolioMenubar.tsx";
import { useEditorRealmCommands } from "./useEditorRealmCommands.ts";

export interface FolioEditorMenubarProps extends FolioMenubarProps {
  /**
   * Hands the real MDXEditor realm-command dispatchers this component
   * computes (`useEditorRealmCommands`) back up to `useFolioActions`, so
   * that hook's `handlers` — used for BOTH the menu's own clicks and the
   * single, always-mounted `useFolioShortcuts` binding in `FolioDocument`
   * — can actually reach them. See `useFolioActions.ts`'s doc on
   * `editorCommandsRef` for the full reasoning.
   */
  onEditorCommands: (commands: Partial<FolioActionHandlers>) => void;
}

/**
 * {@link FolioMenubar} as mounted inside the editor.
 *
 * Mounts through `MarkdownEditor`'s `renderToolbar`
 * (`MarkdownEditorInner.tsx`), i.e. INSIDE MDXEditor's realm provider —
 * the only place `useEditorRealmCommands`'s `usePublisher`/`useCellValue`
 * calls can resolve. `FolioToolbar`, its sibling in the same
 * `renderToolbar` output, mounts the same way for the same reason.
 *
 * The realm wiring is the *only* thing this wrapper adds, and it is why it
 * exists at all: the empty `/folios` state renders `FolioMenubar` directly,
 * with no editor and therefore no realm, and a hook cannot be called
 * conditionally.
 */
const FolioEditorMenubar = (props: FolioEditorMenubarProps): ReactElement => {
  const editorCommands = useEditorRealmCommands();
  const { onEditorCommands, ...menubarProps } = props;

  // `onReady`/`editorCommands` change identity every render (neither is
  // memoized — cheap to recompute, not worth a `useMemo`/`useCallback`
  // pair just to skip a plain object assignment), so this effect re-runs
  // every render too. That is fine: the assignment itself is free, and
  // running it via `useEffect` — rather than during render, the way
  // `MarkdownEditorInner.tsx`'s `renderToolbarRef` has to — is safe here
  // specifically because nothing reads `editorCommandsRef` synchronously
  // within the SAME render pass; it's only ever read later, from a click
  // or keydown handler, by which point any commit strategy has already
  // flushed. The cleanup clears the ref on unmount (the folio locks, or
  // this folio's session ends) so a stale dispatcher — closed over an
  // editor instance MDXEditor is about to tear down — can never fire.
  useEffect(() => {
    onEditorCommands(editorCommands);
    return () => onEditorCommands({});
  }, [editorCommands, onEditorCommands]);

  return <FolioMenubar {...menubarProps} />;
};

export default FolioEditorMenubar;
