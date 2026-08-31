import { useState } from "react";

import MarkdownEditor from "../../shared/markdown-editor/MarkdownEditor.tsx";
import type { MarkdownEditorMode } from "../../shared/markdown-editor/MarkdownEditorInner.tsx";
import MarkdownModeToggle from "../../shared/markdown-editor/MarkdownModeToggle.tsx";

export interface ReleaseDescriptionEditorProps {
  value?: unknown;
  onChange?: (value: unknown) => void;
}

/**
 * The release description's editor: the same View/Edit markdown surface a
 * quest's description gets, in `Control`'s `custom` slot.
 *
 * ## Why not `LoreEditor`
 *
 * `LoreEditor` is the one editor for an ELEMENT, and it takes an
 * `ElementRef` whose `kind` is folio | quest | epic. A release is none of
 * those, and `elementKindSchema` says at length why a fourth member of that
 * union is a change nobody should make for a rendering convenience - it is
 * the discriminator that would then reach the database and the MCP surface.
 *
 * The two things `LoreEditor` adds over the bare editor both need element
 * identity a release does not have:
 *
 * - **Image upload** needs a store. A folio writes to folio blobs, a quest to
 *   quest attachments; an epic has neither and `useElementImageUpload`
 *   already returns nothing for it, with "give epics a store before giving
 *   this an arm" written beside it. A release is in the same position.
 * - **`[[…]]` links** render from anywhere, but the backlink index is built
 *   server-side from folio / quest / epic bodies on save. Offering the `[[`
 *   picker here would create links that resolve one way and are invisible
 *   from the other end.
 *
 * So this is deliberately the plain surface, and it is ~15 lines rather than
 * the five near-identical wrappers `LoreEditor` was created to replace. When
 * a release gets an attachment store and a place in the link index, delete
 * this file and pass an `ElementRef` instead.
 */
const ReleaseDescriptionEditor = (props: ReleaseDescriptionEditorProps) => {
  const [mode, setMode] = useState<MarkdownEditorMode>("edit");

  return (
    // `relative`, so the toggle floats inside the field's top-right corner
    // rather than taking a row above it - the placement `LoreEditor` uses for
    // its `field` variant, and the reason this is not a row of its own.
    <div className="relative">
      <MarkdownModeToggle
        mode={mode}
        onChange={setMode}
        iconOnly
        className="absolute top-1.5 right-1.5 z-10 border bg-transparent"
      />
      <MarkdownEditor
        value={typeof props.value === "string" ? props.value : ""}
        onChange={(next) => props.onChange?.(next)}
        mode={mode}
        lineNumbers={false}
        minHeight={220}
      />
    </div>
  );
};

export default ReleaseDescriptionEditor;
