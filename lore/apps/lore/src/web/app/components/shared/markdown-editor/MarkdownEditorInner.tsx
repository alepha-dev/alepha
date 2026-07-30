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
import { useEffect, useMemo, useRef } from "react";
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
  // Last value we emitted — used to tell "external reset" (e.g. a folio
  // decrypt filling the form) apart from our own onChange echo.
  const lastEmitted = useRef(props.value);

  useEffect(() => {
    if (props.value !== lastEmitted.current) {
      lastEmitted.current = props.value;
      ref.current?.setMarkdown(props.value);
    }
  }, [props.value]);

  const plugins = useMemo(() => {
    const withImages = !!props.imageUploadHandler;
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
      markdownShortcutPlugin(),
      diffSourcePlugin({ viewMode: "rich-text" }),
      toolbarPlugin({
        toolbarClassName: "mdx-toolbar",
        toolbarContents: () => (
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
        ),
      }),
    ];
    return list;
    // The handler's presence decides the plugin set; identity changes of
    // the callback itself must not remount the editor.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [!!props.imageUploadHandler]);

  return (
    <div
      style={
        props.minHeight
          ? ({ "--lore-mdx-min-h": `${props.minHeight}px` } as never)
          : undefined
      }
    >
      <MDXEditor
        ref={ref}
        className="lore-mdx"
        contentEditableClassName="lore-mdx-content"
        markdown={props.value}
        placeholder={props.placeholder}
        plugins={plugins}
        onChange={(markdown) => {
          const normalized = normalizeEditorMarkdown(markdown);
          lastEmitted.current = normalized;
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
