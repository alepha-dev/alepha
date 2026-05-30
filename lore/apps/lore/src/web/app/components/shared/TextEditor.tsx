import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Button } from "@alepha/ui/components/ui/button";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useI18n } from "alepha/react/i18n";
import {
  Bold,
  Code,
  Eye,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pencil,
  Quote,
} from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import type { I18n } from "../../services/I18n.ts";

export interface TextEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

type Action =
  | { kind: "wrap"; before: string; after: string; placeholder: string }
  | { kind: "linePrefix"; prefix: string; placeholder: string }
  | { kind: "link" };

const TextEditor = (props: TextEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const value = props.value ?? "";

  const applyAction = (action: Action) => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);

    let next: string;
    let cursorStart: number;
    let cursorEnd: number;

    if (action.kind === "wrap") {
      const inner = selected || action.placeholder;
      next =
        value.slice(0, start) +
        action.before +
        inner +
        action.after +
        value.slice(end);
      cursorStart = start + action.before.length;
      cursorEnd = cursorStart + inner.length;
    } else if (action.kind === "linePrefix") {
      // Expand selection to whole lines, then prefix each.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = (() => {
        const i = value.indexOf("\n", end);
        return i === -1 ? value.length : i;
      })();
      const block = value.slice(lineStart, lineEnd) || action.placeholder;
      const prefixed = block
        .split("\n")
        .map((l) => action.prefix + l)
        .join("\n");
      next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      cursorStart = lineStart;
      cursorEnd = lineStart + prefixed.length;
    } else {
      // link
      const label = selected || "text";
      const inserted = `[${label}](url)`;
      next = value.slice(0, start) + inserted + value.slice(end);
      // Place cursor on "url" so user can paste it.
      cursorStart = start + label.length + 3;
      cursorEnd = cursorStart + 3;
    }

    props.onChange?.(next);
    // Restore selection after React updates the DOM.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursorStart, cursorEnd);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      applyAction({
        kind: "wrap",
        before: "**",
        after: "**",
        placeholder: "bold",
      });
    } else if (key === "i") {
      e.preventDefault();
      applyAction({
        kind: "wrap",
        before: "_",
        after: "_",
        placeholder: "italic",
      });
    } else if (key === "k") {
      e.preventDefault();
      applyAction({ kind: "link" });
    }
  };

  const Btn = (p: {
    onClick: () => void;
    label: string;
    children: React.ReactNode;
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
      onClick={p.onClick}
      title={p.label}
      aria-label={p.label}
    >
      {p.children}
    </Button>
  );

  return (
    <div className="border-input rounded-md border">
      <div className="border-input flex flex-wrap items-center gap-0.5 border-b px-1 py-1">
        <Btn
          label={tr("editor.bold")}
          onClick={() =>
            applyAction({
              kind: "wrap",
              before: "**",
              after: "**",
              placeholder: "bold",
            })
          }
        >
          <Bold className="h-4 w-4" />
        </Btn>
        <Btn
          label={tr("editor.italic")}
          onClick={() =>
            applyAction({
              kind: "wrap",
              before: "_",
              after: "_",
              placeholder: "italic",
            })
          }
        >
          <Italic className="h-4 w-4" />
        </Btn>
        <Btn
          label={tr("editor.heading")}
          onClick={() =>
            applyAction({
              kind: "linePrefix",
              prefix: "## ",
              placeholder: "Heading",
            })
          }
        >
          <Heading className="h-4 w-4" />
        </Btn>
        <Btn
          label={tr("editor.quote")}
          onClick={() =>
            applyAction({
              kind: "linePrefix",
              prefix: "> ",
              placeholder: "quote",
            })
          }
        >
          <Quote className="h-4 w-4" />
        </Btn>
        <Btn
          label={tr("editor.list")}
          onClick={() =>
            applyAction({
              kind: "linePrefix",
              prefix: "- ",
              placeholder: "item",
            })
          }
        >
          <List className="h-4 w-4" />
        </Btn>
        <Btn
          label={tr("editor.orderedList")}
          onClick={() =>
            applyAction({
              kind: "linePrefix",
              prefix: "1. ",
              placeholder: "item",
            })
          }
        >
          <ListOrdered className="h-4 w-4" />
        </Btn>
        <Btn
          label={tr("editor.code")}
          onClick={() =>
            applyAction({
              kind: "wrap",
              before: "`",
              after: "`",
              placeholder: "code",
            })
          }
        >
          <Code className="h-4 w-4" />
        </Btn>
        <Btn
          label={tr("editor.link")}
          onClick={() => applyAction({ kind: "link" })}
        >
          <LinkIcon className="h-4 w-4" />
        </Btn>
        <div className="ml-auto">
          <Btn
            label={tr(preview ? "editor.edit" : "editor.preview")}
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? (
              <Pencil className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Btn>
        </div>
      </div>
      {preview ? (
        <div className="min-h-64 px-3 py-2">
          {value.trim() ? (
            <MarkdownView content={value} />
          ) : (
            <p className="text-muted-foreground text-sm italic">
              {tr("editor.preview.empty")}
            </p>
          )}
        </div>
      ) : (
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => props.onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.placeholder}
          rows={props.rows ?? 14}
          className="min-h-64 resize-y rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0"
        />
      )}
    </div>
  );
};

export default TextEditor;
