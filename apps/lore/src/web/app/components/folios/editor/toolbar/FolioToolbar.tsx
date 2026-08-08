import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  Separator,
  UndoRedo,
  useCellValue,
  usePublisher,
  viewMode$,
} from "@mdxeditor/editor";
import { useI18n } from "alepha/react/i18n";
import { Save } from "lucide-react";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";
import type { FolioActionState } from "../menubar/folioMenubarModel.ts";
import type { FolioActionHandlers } from "../useFolioActions.ts";

export interface FolioToolbarProps {
  handlers: FolioActionHandlers;
  state: FolioActionState;
  saving: boolean;
  /**
   * Whether the draft differs from what is stored. Save is pointless
   * otherwise, and an always-enabled Save button invites the reader to
   * wonder what it would do.
   */
  dirty: boolean;
  /**
   * Whether an image upload handler is wired — hides `InsertImage`
   * entirely when it isn't (a protected folio), mirroring
   * `MarkdownEditorInner`'s own `withImages` gate on the default toolbar.
   */
  hasImageUpload: boolean;
}

/**
 * The formatting toolbar row, directly below `FolioMenubar`. The left group
 * renders MDXEditor's own toolbar primitives verbatim — each one dispatches
 * its own realm command internally (confirmed by reading their sources:
 * `BoldItalicUnderlineToggles`/`CodeToggle` publish to `applyFormat$`,
 * `ListsToggle` to `applyListType$`, `CreateLink` to `openLinkEditDialog$`,
 * `InsertImage` to `openNewImageDialog$`, `InsertTable`/`InsertCodeBlock`/
 * `InsertThematicBreak` to their own signals) — so this component wires
 * nothing for them beyond choosing which ones to show.
 *
 * The Rich/md switch is the one custom piece: it reads and writes
 * `viewMode$` directly rather than using MDXEditor's own
 * `DiffSourceToggleWrapper`. That component's built-in toggle isn't
 * restylable into the design's `Segmented` pill (no `className`/render
 * prop, and its own toggle group renders unconditionally alongside
 * whatever `children` it's given — hiding it would need a CSS rule
 * targeting the library's internal, version-coupled class names). Reading
 * `viewMode$` directly gives full control over both the toggle's look AND
 * the "hide formatting buttons outside rich-text mode" behavior
 * `DiffSourceToggleWrapper` otherwise provides for free, with no
 * duplicate toggle UI to suppress.
 */
const FolioToolbar = (props: FolioToolbarProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const viewMode = useCellValue(viewMode$);
  const changeViewMode = usePublisher(viewMode$);

  // 52px and a second step off the card, per the design. The status line
  // is NOT here: the design keeps it on the menubar row and gates this
  // row's own copy behind `showDocActions`, which the shipped state has
  // switched off. Duplicating it in both places would just be noise.
  return (
    <div className="border-border bg-muted/60 flex h-[52px] flex-none items-center gap-1 border-b pr-3 pl-2.5">
      {viewMode === "rich-text" && (
        <div className="folio-toolbar-buttons flex items-center gap-1">
          <UndoRedo />
          <Separator />
          <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
          <CodeToggle />
          <Separator />
          <BlockTypeSelect />
          <ListsToggle options={["bullet", "number", "check"]} />
          <Separator />
          <CreateLink />
          {props.hasImageUpload && <InsertImage />}
          <InsertTable />
          <InsertCodeBlock />
          <InsertThematicBreak />
        </div>
      )}

      <div className="flex-1" />

      {/* Same size token as the Save button beside it — `Segmented` is
          built to line up pixel-for-pixel with a `Button` of the matching
          token, and `xs` against a `sm` button was a 4px mismatch sitting
          in the middle of the row. */}
      <Segmented
        size="sm"
        value={viewMode === "source" ? "md" : "rich-text"}
        onChange={(value) =>
          changeViewMode(value === "md" ? "source" : "rich-text")
        }
        options={[
          { value: "rich-text", label: tr("folios.editor.toolbar.rich") },
          { value: "md", label: tr("folios.editor.toolbar.md") },
        ]}
      />

      <Button
        size="sm"
        onClick={() => props.handlers["folio.save"]()}
        disabled={props.saving || props.state.locked || !props.dirty}
      >
        <Save className="size-4" />
        {tr("folios.editor.action.save")}
      </Button>
    </div>
  );
};

export default FolioToolbar;
