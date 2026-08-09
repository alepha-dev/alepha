import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  codeBlockPlugin,
  codeMirrorPlugin,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  headingsPlugin,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  imagePlugin,
  ListsToggle,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  type MDXEditorMethods,
  markdownShortcutPlugin,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  type WikiLinkEditorContext,
  wikiLinkPlugin,
} from "../../folios/editor/wikilink/wikiLinkPlugin.tsx";
import { normalizeEditorMarkdown } from "./normalizeEditorMarkdown.ts";
import "@mdxeditor/editor/style.css";

export interface MarkdownEditorInnerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Uploads the picked image and resolves to the URL to embed. When
   * omitted, the image plugin and its toolbar button are not mounted.
   */
  imageUploadHandler?: (file: File) => Promise<string>;
  minHeight?: number;
  /**
   * Replaces the default toolbar contents. Rendered inside MDXEditor's
   * realm provider, so the returned tree can use the editor's own toolbar
   * primitives and dispatch its formatting commands — which is the only
   * place those commands are reachable from.
   *
   * Omitted → the default single-row toolbar every other caller gets.
   */
  renderToolbar?: () => ReactNode;
  /**
   * `"bare"` drops the editor's own frame — border, radius, background —
   * and switches the body to the folio reading face. The folio workspace
   * uses it because the document there is the page itself, not a field on
   * a form: the design has the prose flowing straight under the summary
   * divider with nothing boxing it in. Every other caller (quest
   * descriptions, feedback replies) keeps the default framed look.
   */
  variant?: "framed" | "bare";
  /**
   * Turns `[[…]]` references into live, decorated tokens inside the body,
   * and enables the `[[` picker (#131). Omitted → neither is mounted, and
   * a wiki-link is inert text exactly as before.
   *
   * Its presence, not its identity, decides the plugin set — see the memo
   * below. The value itself is read through a ref on every resolve, so the
   * caller may hand a new object every render without remounting Lexical.
   */
  wikiLinks?: WikiLinkEditorContext;
}

/**
 * The real MDXEditor. Only ever imported through `MarkdownEditor`'s lazy
 * boundary — never from server-evaluated code.
 *
 * Markdown is the single source of truth: this component is a view over
 * the string the caller owns. Output is normalized so Lore-specific
 * syntax (wiki-links) survives the WYSIWYG round-trip.
 */
const MarkdownEditorInner = (props: MarkdownEditorInnerProps) => {
  const ref = useRef<MDXEditorMethods>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Last value we emitted — used to tell "external reset" (e.g. a folio
  // decrypt filling the form) apart from our own onChange echo.
  const lastEmitted = useRef(props.value);
  // Whether the user has actually engaged with this editor yet.
  //
  // MDXEditor parses the markdown on mount and fires `onChange` with its
  // own re-serialization of it, which is not the same string for most
  // real documents: `* item` becomes `- item`, `*emphasis*` becomes
  // `_emphasis_`, a setext heading becomes an ATX one, table cells get
  // repadded, a trailing-space hard break turns into a backslash. Passing
  // that up made every such document report unsaved changes the instant it
  // opened, before the reader had done anything — and agent-written folios
  // (tables, `*` bullets) hit it almost every time.
  //
  // The emission is real, it just isn't an EDIT, so it must not reach the
  // owning form. Focus is the discriminator, the same one the sync effect
  // below already trusts: typing needs focus, and so does any toolbar
  // command, which acts on a selection the user had to make first. Until
  // focus lands inside, an emission is the editor talking to itself.
  const userTouched = useRef(false);
  // `renderToolbar` closes over workspace state that changes on every
  // keystroke. Keeping it in a ref lets `toolbarContents` always call the
  // latest version WITHOUT the plugin memo (below) depending on its
  // identity — which would otherwise remount Lexical on every render.
  //
  // The assignment below runs DURING RENDER, on purpose — do not "clean
  // this up" into a `useEffect`/`useLayoutEffect` latest-ref idiom. The
  // toolbar plugin's `toolbarContents()` (in the `plugins` memo below) is
  // invoked synchronously as part of the *same* top-down render pass, when
  // React renders the toolbar plugin's own child — which happens before
  // this component's effects are flushed, textbook `useLayoutEffect`
  // included. An effect-based assignment would still hold the *previous*
  // render's `props.renderToolbar` at the moment `toolbarContents()` reads
  // it, permanently one render stale — every keystroke would paint the
  // toolbar one edit behind the document. Assigning here, in the render
  // body, guarantees the ref is current before `toolbarContents()` ever
  // runs in this pass.
  const renderToolbarRef = useRef(props.renderToolbar);
  renderToolbarRef.current = props.renderToolbar;
  // Same reason, same render-body assignment: the wiki-link plugin resolves
  // a token against the project's current folio / quest / blob lists, which
  // change while the editor stays mounted (a new folio is created in the
  // tree, a file is uploaded). Passing the context as a plugin parameter
  // would freeze it at first render, since the plugin array below is
  // memoized precisely so a re-render does not remount Lexical.
  const wikiLinksRef = useRef(props.wikiLinks);
  wikiLinksRef.current = props.wikiLinks;

  useEffect(() => {
    if (props.value === lastEmitted.current) {
      return;
    }
    // While the user is typing, the owning form can re-render with a
    // value that lags one keystroke behind what we just emitted. Treating
    // that stale echo as an external reset rewrites the document under
    // the cursor and silently drops recent input (it ate list items in
    // manual testing). External programmatic fills (folio decrypt, dialog
    // re-prime) happen while the editor is NOT focused — so only sync
    // when focus is elsewhere.
    const active = document.activeElement;
    if (active && wrapperRef.current?.contains(active)) {
      return;
    }
    lastEmitted.current = props.value;
    ref.current?.setMarkdown(props.value);
  }, [props.value]);

  const plugins = useMemo(() => {
    const withImages = !!props.imageUploadHandler;
    const withWikiLinks = !!props.wikiLinks;
    const list = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
      codeMirrorPlugin({
        codeBlockLanguages: {
          "": "Plain",
          ts: "TypeScript",
          tsx: "TSX",
          js: "JavaScript",
          json: "JSON",
          sql: "SQL",
          bash: "Shell",
          css: "CSS",
          html: "HTML",
          md: "Markdown",
          yaml: "YAML",
        },
      }),
      ...(withImages
        ? [
            imagePlugin({
              imageUploadHandler: props.imageUploadHandler,
              disableImageResize: true,
            }),
          ]
        : []),
      ...(withWikiLinks ? [wikiLinkPlugin({ contextRef: wikiLinksRef })] : []),
      markdownShortcutPlugin(),
      diffSourcePlugin({ viewMode: "rich-text" }),
      toolbarPlugin({
        toolbarClassName: "mdx-toolbar",
        toolbarContents: () => {
          const custom = renderToolbarRef.current;
          if (custom) return <>{custom()}</>;
          return (
            <DiffSourceToggleWrapper options={["rich-text", "source"]}>
              <UndoRedo />
              <Separator />
              <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
              <CodeToggle />
              <Separator />
              <BlockTypeSelect />
              <ListsToggle options={["bullet", "number", "check"]} />
              <Separator />
              <CreateLink />
              {withImages && <InsertImage />}
              <InsertTable />
              <InsertCodeBlock />
              <InsertThematicBreak />
            </DiffSourceToggleWrapper>
          );
        },
      }),
    ];
    return list;
    // Presence, not identity, decides the plugin set — for the upload
    // handler and for the wiki-link context alike. Depending on either
    // object would remount the editor (and drop the caret) on every render
    // of the owning form.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [!!props.imageUploadHandler, !!props.wikiLinks]);

  return (
    <div
      ref={wrapperRef}
      // React's onFocus is the bubbling `focusin`, and it crosses the
      // portal the folio workspace renders its toolbar through — so a
      // click on Bold marks the editor touched just as typing does.
      onFocus={() => {
        userTouched.current = true;
      }}
      style={
        props.minHeight
          ? ({ "--lore-mdx-min-h": `${props.minHeight}px` } as never)
          : undefined
      }
    >
      <MDXEditor
        ref={ref}
        className={
          props.variant === "bare" ? "lore-mdx lore-mdx-bare" : "lore-mdx"
        }
        contentEditableClassName="lore-mdx-content"
        markdown={props.value}
        placeholder={props.placeholder}
        plugins={plugins}
        onChange={(markdown) => {
          const normalized = normalizeEditorMarkdown(markdown);
          lastEmitted.current = normalized;
          // See `userTouched`: before the user has engaged, this is the
          // editor's own re-serialization of the document it was handed,
          // not an edit. Recording it in `lastEmitted` (so the sync effect
          // still recognises our own output) but not passing it up is what
          // keeps a freshly-opened document reading as saved.
          if (!userTouched.current) return;
          props.onChange(normalized);
        }}
        toMarkdownOptions={{
          bullet: "-",
          listItemIndent: "one",
          emphasis: "_",
          strong: "*",
          rule: "-",
        }}
        onError={(payload) => {
          // A parse error must never eat user content — log and keep
          // going; the source mode remains available for manual repair.
          console.error("MarkdownEditor error", payload);
        }}
      />
    </div>
  );
};

export default MarkdownEditorInner;
