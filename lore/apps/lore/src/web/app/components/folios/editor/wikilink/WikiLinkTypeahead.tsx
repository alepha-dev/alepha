import { cn } from "@alepha/ui/lib/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { useCellValue } from "@mdxeditor/gurx";
import { $createTextNode, type TextNode } from "lexical";
import { FileText, Paperclip, Swords } from "lucide-react";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  type WikiLinkSuggestion,
  wikiLinkContextRef$,
} from "./wikiLinkPlugin.tsx";

const MAX_RESULTS = 8;

/**
 * The `[[` reference picker.
 *
 * Mounted as an MDXEditor composer child, so it lives inside Lexical's own
 * React context and can drive the editor directly. It inserts the plain
 * `[[token]]` text and stops there — the text entity registered in
 * `wikiLinkPlugin` is what turns that into a `WikiLinkNode`, so insertion and
 * hand-typing converge on exactly one code path.
 */
const WikiLinkTypeahead = (): ReactElement | null => {
  const [editor] = useLexicalComposerContext();
  const contextRef = useCellValue(wikiLinkContextRef$);
  const [query, setQuery] = useState<string | null>(null);

  const options = useMemo(() => {
    if (query === null) return [];
    const all = contextRef?.current?.suggestions ?? [];
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? all.filter(
          (s) =>
            s.label.toLowerCase().includes(needle) ||
            s.token.toLowerCase().includes(needle),
        )
      : all;
    return matches.slice(0, MAX_RESULTS).map((s) => new WikiLinkOption(s));
  }, [query, contextRef]);

  const onSelect = useCallback(
    (
      option: WikiLinkOption,
      nodeToReplace: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        const node = $createTextNode(`[[${option.suggestion.token}]]`);
        if (nodeToReplace) nodeToReplace.replace(node);
        else return;
        // Collapse the caret AFTER the token. Selecting the node itself
        // would leave the whole reference highlighted, and the next
        // keystroke would replace it.
        node.selectEnd();
        closeMenu();
      });
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<WikiLinkOption>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelect}
      triggerFn={matchWikiLinkTrigger}
      menuRenderFn={(anchorRef, itemProps) => {
        if (!anchorRef.current || options.length === 0) return null;
        return createPortal(
          <div className="bg-popover text-popover-foreground border-border z-50 max-h-72 w-80 overflow-y-auto rounded-md border p-1 shadow-lg">
            {options.map((option, index) => (
              <button
                key={option.key}
                type="button"
                ref={(el) => option.setRefElement(el)}
                // `mousedown` and not `click`: a click would have already
                // moved focus out of the contenteditable, and the editor's
                // selection — which `onSelectOption` needs to replace the
                // query — is gone by then.
                onMouseDown={(e) => {
                  e.preventDefault();
                  itemProps.selectOptionAndCleanUp(option);
                }}
                onMouseEnter={() => itemProps.setHighlightedIndex(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                  index === itemProps.selectedIndex && "bg-accent",
                )}
              >
                <OptionIcon kind={option.suggestion.kind} />
                <span className="min-w-0 flex-1 truncate">
                  {option.suggestion.label}
                </span>
                {option.suggestion.hint && (
                  <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                    {option.suggestion.hint}
                  </span>
                )}
              </button>
            ))}
          </div>,
          anchorRef.current,
        );
      }}
    />
  );
};

interface OptionIconProps {
  kind: WikiLinkSuggestion["kind"];
}

const OptionIcon = (props: OptionIconProps): ReactElement => {
  const Icon =
    props.kind === "quest"
      ? Swords
      : props.kind === "blob"
        ? Paperclip
        : FileText;
  return <Icon className="text-muted-foreground size-3.5 shrink-0" />;
};

class WikiLinkOption extends MenuOption {
  suggestion: WikiLinkSuggestion;

  constructor(suggestion: WikiLinkSuggestion) {
    super(suggestion.key);
    this.suggestion = suggestion;
  }
}

/**
 * Opens on `[[` and stays open until the reference is closed or abandoned.
 *
 * Deliberately NOT `useBasicTypeaheadTriggerMatch`: that helper is built for
 * single-character triggers preceded by whitespace, and it terminates the
 * query on punctuation. Every interesting wiki-link token is punctuation —
 * `#66`, `quest#7`, `blob:#3`, `plans/drizzle` — so the basic matcher would
 * close the menu on the first character that matters. Whitespace is allowed
 * in the query too, because folio titles have spaces in them; `]` is the
 * terminator instead, since a closed token needs no more suggestions.
 */
const TRIGGER_RE = /\[\[([^[\]\n]*)$/;

const matchWikiLinkTrigger = (text: string): MenuTextMatch | null => {
  const match = TRIGGER_RE.exec(text);
  if (!match) return null;
  return {
    leadOffset: match.index,
    matchingString: match[1],
    replaceableString: match[0],
  };
};

export default WikiLinkTypeahead;
