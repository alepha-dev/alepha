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
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Save } from "lucide-react";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";
import type { FolioActionState } from "../menubar/folioMenubarModel.ts";
import type { FolioActionHandlers } from "../useFolioActions.ts";

export interface FolioToolbarProps {
  handlers: FolioActionHandlers;
  state: FolioActionState;
  statusKey: "draft" | "saved" | "unsaved";
  savedAt?: string;
  saving: boolean;
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
  const dt = useInject(DateTimeProvider);
  const viewMode = useCellValue(viewMode$);
  const changeViewMode = usePublisher(viewMode$);

  const statusLabel =
    props.statusKey === "saved" && props.savedAt
      ? tr("folios.editor.status.saved", {
          args: [String(dt.of(props.savedAt).fromNow())],
        })
      : tr(`folios.editor.status.${props.statusKey}`);

  return (
    <div className="flex h-9 flex-none items-center gap-1 border-b border-border px-2">
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

      <Segmented
        size="xs"
        value={viewMode === "source" ? "md" : "rich-text"}
        onChange={(value) =>
          changeViewMode(value === "md" ? "source" : "rich-text")
        }
        options={[
          { value: "rich-text", label: tr("folios.editor.toolbar.rich") },
          { value: "md", label: tr("folios.editor.toolbar.md") },
        ]}
      />

      <span className="text-muted-foreground folio-mono text-xs">
        {statusLabel}
      </span>

      <Button
        size="sm"
        onClick={() => props.handlers["folio.save"]()}
        disabled={props.saving || props.state.locked}
      >
        <Save className="size-4" />
        {tr("folios.editor.action.save")}
      </Button>
    </div>
  );
};

export default FolioToolbar;
