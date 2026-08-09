import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import {
  applyBlockType$,
  applyListType$,
  type BlockType,
  currentBlockType$,
  currentFormat$,
  currentListType$,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  useCellValue,
  usePublisher,
  viewMode$,
} from "@mdxeditor/editor";
import { useI18n } from "alepha/react/i18n";
import {
  Bold,
  Code,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Redo2,
  Save,
  SquareCode,
  Table as TableIcon,
  Undo2,
} from "lucide-react";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";
import type { FolioActionState } from "../menubar/folioMenubarModel.ts";
import type { FolioActionHandlers } from "../useFolioActions.ts";
import FolioToolbarButton from "./FolioToolbarButton.tsx";

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
   * Whether an image upload handler is wired — hides the image button
   * entirely when it isn't (a protected folio), mirroring
   * `MarkdownEditorInner`'s own `withImages` gate on the default toolbar.
   */
  hasImageUpload: boolean;
}

/**
 * The formatting toolbar row, directly below `FolioMenubar`.
 *
 * Every control is a house `Button` (via `FolioToolbarButton`) or a house
 * `Select`/`Segmented` — MDXEditor's own toolbar components are not used
 * here at all. They brought their own markup and sizing that no amount of
 * wrapper CSS lined up with the Save button beside them, and they could
 * not take a `variant`. What they DID provide for free was the active
 * state, so that is read directly from the realm instead: `currentFormat$`
 * is a bitmask of the marks at the caret, `currentBlockType$` and
 * `currentListType$` the block context. Commands go out through the same
 * `handlers` a menu click or a keyboard shortcut uses, so a button, a menu
 * item and a shortcut all take one path.
 *
 * This component mounts inside MDXEditor's realm (through `renderToolbar`,
 * portalled up by `FolioDocument`), which is the only place `useCellValue`
 * and `usePublisher` resolve.
 */
const FolioToolbar = (props: FolioToolbarProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const viewMode = useCellValue(viewMode$);
  const changeViewMode = usePublisher(viewMode$);
  const format = useCellValue(currentFormat$);
  const blockType = useCellValue(currentBlockType$);
  const listType = useCellValue(currentListType$);
  const applyBlockType = usePublisher(applyBlockType$);
  const applyListType = usePublisher(applyListType$);

  const label = (key: string): string => String(tr(key));
  const run = (id: keyof FolioActionHandlers) => () => props.handlers[id]();

  const BLOCK_TYPES: { value: BlockType; labelKey: string }[] = [
    { value: "paragraph", labelKey: "folios.editor.block.paragraph" },
    { value: "h1", labelKey: "folios.editor.block.h1" },
    { value: "h2", labelKey: "folios.editor.block.h2" },
    { value: "h3", labelKey: "folios.editor.block.h3" },
    { value: "quote", labelKey: "folios.editor.action.quote" },
  ];

  // 52px, and scoped to the DOCUMENT PANE rather than bleeding across the
  // whole workspace: this row formats the document, so it has no business
  // spanning the folio tree and the inspector the way the menubar above it
  // legitimately does.
  //
  // Padded to `px-8` — the prose's own inset — rather than held to the
  // prose's `max-w-[812px]` measure, which was tried first and does not
  // work: the controls need ~810px and the measure leaves ~748, so the row
  // overflowed its box and the Save button rendered on top of the
  // inspector's tab bar. Since the pane is narrower than 812px whenever the
  // tree and inspector are both open, `px-8` lines the row up with the text
  // exactly in the common case, and merely starts it left of a centred
  // column in the wide/focus-mode case. `overflow-x-auto` on the button
  // group is the backstop for a genuinely cramped pane — it keeps the
  // spill inside this row instead of over the pane beside it.
  //
  // The status line is NOT here: the design keeps it on the menubar row and
  // gates this row's own copy behind `showDocActions`, which the shipped
  // state has switched off. Duplicating it in both places would be noise.
  return (
    <div data-slot="folio-toolbar" className="w-full flex-none px-8">
      <div className="border-border flex h-[52px] items-center gap-1 border-b">
        {viewMode === "rich-text" && (
          // Pulled left by the ghost buttons' own padding so the first
          // icon sits on the prose's left edge, not the button box does.
          <div className="-ml-2 flex min-w-0 items-center gap-0.5 overflow-x-auto">
            <FolioToolbarButton
              label={label("folios.editor.action.undo")}
              icon={Undo2}
              onClick={run("edit.undo")}
            />
            <FolioToolbarButton
              label={label("folios.editor.action.redo")}
              icon={Redo2}
              onClick={run("edit.redo")}
            />

            <div className="bg-border mx-1 h-5.5 w-px" />

            <Select
              value={blockType || "paragraph"}
              onValueChange={(value) => applyBlockType(value as BlockType)}
            >
              <SelectTrigger
                size="sm"
                className="w-30"
                aria-label={label("folios.editor.block.label")}
              >
                {/* The label, not the raw value: left to itself the trigger
                  renders the realm's own vocabulary ("h2"), which is an
                  implementation detail and untranslatable. */}
                <SelectValue>
                  {tr(
                    BLOCK_TYPES.find(
                      (b) => b.value === (blockType || "paragraph"),
                    )?.labelKey ?? "folios.editor.block.paragraph",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BLOCK_TYPES.map((b) => (
                  <SelectItem key={b.value} value={b.value as string}>
                    {tr(b.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="bg-border mx-1 h-5.5 w-px" />

            <FolioToolbarButton
              label={label("folios.editor.action.bold")}
              icon={Bold}
              active={(format & IS_BOLD) !== 0}
              onClick={run("edit.bold")}
            />
            <FolioToolbarButton
              label={label("folios.editor.action.italic")}
              icon={Italic}
              active={(format & IS_ITALIC) !== 0}
              onClick={run("edit.italic")}
            />
            <FolioToolbarButton
              label={label("folios.editor.action.code")}
              icon={Code}
              active={(format & IS_CODE) !== 0}
              onClick={run("edit.code")}
            />

            <div className="bg-border mx-1 h-5.5 w-px" />

            <FolioToolbarButton
              label={label("folios.editor.action.bullet-list")}
              icon={List}
              active={listType === "bullet"}
              onClick={() => applyListType("bullet")}
            />
            <FolioToolbarButton
              label={label("folios.editor.action.numbered-list")}
              icon={ListOrdered}
              active={listType === "number"}
              onClick={() => applyListType("number")}
            />
            <FolioToolbarButton
              label={label("folios.editor.action.task-list")}
              icon={ListChecks}
              active={listType === "check"}
              onClick={() => applyListType("check")}
            />

            <div className="bg-border mx-1 h-5.5 w-px" />

            <FolioToolbarButton
              label={label("folios.editor.action.link")}
              icon={LinkIcon}
              onClick={run("edit.link")}
            />
            {props.hasImageUpload && (
              <FolioToolbarButton
                label={label("folios.editor.action.image")}
                icon={ImageIcon}
                onClick={run("insert.image")}
              />
            )}
            <FolioToolbarButton
              label={label("folios.editor.action.table")}
              icon={TableIcon}
              onClick={run("insert.table")}
            />
            <FolioToolbarButton
              label={label("folios.editor.action.code-block")}
              icon={SquareCode}
              onClick={run("insert.codeBlock")}
            />
            <FolioToolbarButton
              label={label("folios.editor.action.divider")}
              icon={Minus}
              onClick={run("insert.divider")}
            />
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
    </div>
  );
};

export default FolioToolbar;
