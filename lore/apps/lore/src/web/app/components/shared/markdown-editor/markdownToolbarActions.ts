import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  Quote,
  SquareCode,
} from "lucide-react";

import type { MarkdownCommandId } from "./markdownCommands.ts";

export interface MarkdownToolbarAction {
  id: MarkdownCommandId;
  /**
   * ⚠️ These are `folios.editor.*` keys in a component the quest surfaces
   * mount too. They are reused rather than duplicated under `markdown.*`
   * because both locales already carry every one of them and the words are
   * generic ("Heading 1", "Quote") - a parallel namespace would be twelve
   * new strings saying the same thing. If a toolbar ever needs a label the
   * menubar does not have, take the group list as a prop from the caller
   * instead of growing this union.
   */
  labelKey:
    | "folios.editor.action.bold"
    | "folios.editor.action.italic"
    | "folios.editor.action.code"
    | "folios.editor.action.link"
    | "folios.editor.action.heading1"
    | "folios.editor.action.heading2"
    | "folios.editor.action.heading3"
    | "folios.editor.action.bullet-list"
    | "folios.editor.action.quote"
    | "folios.editor.action.code-block";
  Icon: typeof Bold;
}

/**
 * The one button table both markdown toolbars draw from: the floating one
 * over a selection and the fixed one above a description field (feedback
 * #2056). One table, so the two can never offer different formatting.
 *
 * Grouped, and rendered with a rule between groups, because ten
 * undifferentiated icons stop being a quick gesture and start being a
 * ribbon. The order is inline formatting → block structure → containers.
 *
 * Every command already existed in `markdownCommands`; nothing here is a
 * new transform except `insert.link`, which the selection toolbar had no
 * room for and a fixed bar has.
 */
export const MARKDOWN_TOOLBAR_GROUPS: MarkdownToolbarAction[][] = [
  [
    { id: "edit.bold", labelKey: "folios.editor.action.bold", Icon: Bold },
    {
      id: "edit.italic",
      labelKey: "folios.editor.action.italic",
      Icon: Italic,
    },
    { id: "edit.code", labelKey: "folios.editor.action.code", Icon: Code },
    { id: "insert.link", labelKey: "folios.editor.action.link", Icon: Link },
  ],
  [
    {
      id: "insert.heading1",
      labelKey: "folios.editor.action.heading1",
      Icon: Heading1,
    },
    {
      id: "insert.heading2",
      labelKey: "folios.editor.action.heading2",
      Icon: Heading2,
    },
    {
      id: "insert.heading3",
      labelKey: "folios.editor.action.heading3",
      Icon: Heading3,
    },
  ],
  [
    {
      id: "insert.bulletList",
      labelKey: "folios.editor.action.bullet-list",
      Icon: List,
    },
    { id: "insert.quote", labelKey: "folios.editor.action.quote", Icon: Quote },
    {
      id: "insert.codeBlock",
      labelKey: "folios.editor.action.code-block",
      Icon: SquareCode,
    },
  ],
];
