import { useI18n } from "alepha/react/i18n";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface TreeViewRenameInputProps {
  /**
   * The name to open on. Read once, at mount: while the input is up the
   * draft is the user's, not the node's.
   */
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/**
 * The inline rename input that replaces a row's label.
 *
 * ⚠️ **Its own component on purpose, and it must stay one.** Two reasons, and
 * the second is the one that bites.
 *
 * It calls `useI18n`, so a tree that never renames anything (a read-only
 * navigation tree, a docs file tree) would otherwise have to mount
 * `AlephaReactI18n` to render a single row.
 *
 * And mounting IS the draft reset. Inlining the input back into the row means
 * the row stays mounted across the whole rename, so `useState(name)`'s
 * initializer runs once for the life of the row and renaming the same row a
 * second time reopens showing the name it had before the FIRST rename. That
 * bug is why the row it came from carried a `wasRenamingRef` and React's
 * "adjust state during render" dance; a component that unmounts when the
 * rename ends needs neither. `tree-view-rename.browser.spec.tsx` pins the
 * second rename, so the bug cannot come back quietly.
 */
export const TreeViewRenameInput = (
  props: TreeViewRenameInputProps,
): ReactElement => {
  const { tr } = useI18n();
  const [draft, setDraft] = useState(props.name);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * ⚠️ Removing a focused element from the DOM can still fire `blur` in some
   * browsers before the fiber is torn down, so Escape would otherwise commit
   * the very edit it cancelled. The flag is what tells a real blur-to-commit
   * from that one.
   */
  const cancelledRef = useRef(false);

  // Focus and select on appear. The a11y rule that removed `autoFocus` left
  // rename opening an input nobody could type into without clicking it first.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleBlur = (): void => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    props.onCommit(draft);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      // Commit through blur, so Enter and clicking away are one path.
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancelledRef.current = true;
      props.onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      data-slot="tree-view-rename-input"
      aria-label={tr("treeView.rename", { default: "New name" })}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      // The row beneath opens the node on click; typing in the input must
      // not also be a click on the row.
      onClick={(e: MouseEvent) => e.stopPropagation()}
      className="border-primary bg-background min-w-0 flex-1 rounded border px-1 text-sm outline-none"
    />
  );
};
