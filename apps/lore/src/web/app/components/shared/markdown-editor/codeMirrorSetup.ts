import {
  autocompletion,
  type CompletionSource,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
// `EditorState` is imported as a VALUE, not a type — `EditorState.readOnly`
// is a facet read at runtime at the bottom of this file.
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

export interface MarkdownExtensionOptions {
  placeholder?: string;
  readOnly?: boolean;
  /**
   * Extra completion sources — the `[[` wiki-link picker is the only one
   * today. Absent or empty means the autocompletion extension is not mounted
   * at all, so nothing pops up while typing prose.
   */
  completionSources?: CompletionSource[];
  /**
   * Show the numbered gutter. Off by default: it earns its place on a long
   * document, where "the table in the middle" needs a coordinate, and reads
   * as an IDE affordance on a three-line description field.
   *
   * Numbers count SOURCE lines, not visual rows — `EditorView.lineWrapping`
   * is mounted, so a wrapped paragraph shows one number and blank gutter
   * space for each continuation row. That is the honest mapping: the number
   * is what a `[[folio#L12]]`-style reference or an error would name.
   */
  lineNumbers?: boolean;
}

/**
 * Markdown token colours, expressed on the shadcn tokens so the editor
 * follows every Lore theme and light/dark automatically.
 *
 * This is the whole of the theming work. The editor it replaced needed ~280
 * lines in `main.css` mapping MDXEditor's bundled Radix Colors scale onto
 * ours; CodeMirror takes a theme object and `var(--color-*)` resolves
 * against the surrounding cascade, so there is nothing per-theme here and
 * nothing to re-check when a theme is added.
 */
const loreHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "600", fontSize: "1.3em" },
  { tag: tags.heading2, fontWeight: "600", fontSize: "1.15em" },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    fontWeight: "600",
  },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: [tags.link, tags.url],
    color: "var(--color-primary)",
    textDecoration: "underline",
  },
  { tag: tags.monospace, color: "var(--color-primary)" },
  {
    tag: tags.quote,
    color: "var(--color-muted-foreground)",
    fontStyle: "italic",
  },
  { tag: tags.list, color: "var(--color-muted-foreground)" },
  { tag: tags.contentSeparator, color: "var(--color-muted-foreground)" },
  // The syntax markers themselves (`#`, `*`, `-`, backticks). Dimmed so the
  // prose reads first and the markup recedes — the closest a raw editor gets
  // to the WYSIWYG it replaced, without any of the round-trip risk.
  {
    tag: tags.processingInstruction,
    color: "var(--color-muted-foreground)",
    opacity: "0.6",
  },
]);

const loreTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--color-foreground)",
    fontSize: "14px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    padding: "0",
    caretColor: "var(--color-foreground)",
  },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--color-muted-foreground)" },
  // Native selection. `drawSelection()` is deliberately NOT mounted (see
  // the extension list), so this is the real `::selection`, not
  // CodeMirror's painted stand-in.
  "::selection": { backgroundColor: "var(--color-accent)" },
  ".cm-panels": {
    backgroundColor: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-foreground)",
  },
  // The gutter is only ever mounted behind `options.lineNumbers`, but it is
  // themed unconditionally — a theme is a stylesheet, not an extension, and
  // rules for an absent element cost nothing.
  //
  // Transparent rather than the muted fill CodeMirror ships: this sits
  // inside a document, and a filled column down the left reads as a code
  // block. The numbers are dimmed to `muted-foreground` at the same 0.6 the
  // syntax markers use, so they recede the way `#` and `*` do.
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--color-border)",
    color: "var(--color-muted-foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.85em",
    opacity: "0.6",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 0.5rem 0 0.25rem",
    minWidth: "2.25rem",
  },
  // `highlightActiveLine()` is not mounted (see the extension list), and its
  // gutter twin is not either — there is no active-line marker to tint, so
  // the numbers stay uniform rather than one of them lighting up with
  // nothing beside it to explain why.
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
});

/**
 * The extension list for a markdown editing surface.
 *
 * Split out of the component so it can be unit-tested against a bare
 * `EditorState` — constructing an `EditorView` measures layout, which jsdom
 * cannot supply, so anything asserted through a live view would be testing
 * the environment instead of this list.
 */
export const createMarkdownExtensions = (
  options: MarkdownExtensionOptions,
): Extension[] => {
  const extensions: Extension[] = [
    // ⚠️ `drawSelection()` and `highlightActiveLine()` are deliberately
    // absent, and both were mounted once by mistake.
    //
    // `drawSelection()` replaces the browser's caret and selection with
    // painted elements — it sets `caret-color: transparent` and draws a
    // `.cm-cursor` div instead. It exists for multi-cursor editing, which
    // this surface does not do, and its cost here was that the caret simply
    // vanished: `caretColor` below applies to a caret that is no longer
    // being drawn.
    //
    // `highlightActiveLine()` paints a full-width grey band behind the line
    // the caret is on. That is a code-editor affordance; in a document it
    // reads as a stray rule across the prose, and it was the only thing
    // visible where the cursor should have been.
    history(),
    search({ top: true }),
    // Long prose lines wrap rather than scrolling sideways. The single most
    // load-bearing line here for a document editor — without it a folio
    // paragraph becomes one endless horizontal line.
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(loreHighlightStyle),
    closeBrackets(),
    loreTheme,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
    ]),
  ];

  if (options.lineNumbers) {
    extensions.push(lineNumbers());
  }

  if (options.placeholder) {
    extensions.push(placeholderExtension(options.placeholder));
  }

  if (options.completionSources?.length) {
    extensions.push(
      autocompletion({
        override: options.completionSources,
        closeOnBlur: true,
      }),
    );
  }

  if (options.readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  return extensions;
};
