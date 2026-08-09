import { type EntityMatch, registerLexicalTextEntity } from "@lexical/text";
import {
  addComposerChild$,
  addLexicalNode$,
  createRootEditorSubscription$,
  realmPlugin,
} from "@mdxeditor/editor";
import { Cell } from "@mdxeditor/gurx";
import type { LexicalEditor, TextNode } from "lexical";
import type { WikiLinkTarget } from "../../folioWikiLinkResolver.ts";
import {
  $createWikiLinkNode,
  $isWikiLinkNode,
  WikiLinkNode,
} from "./WikiLinkNode.ts";
import WikiLinkTypeahead from "./WikiLinkTypeahead.tsx";

/**
 * One candidate the `[[` popover can insert.
 *
 * `token` is what goes between the brackets and `label` is what the reader
 * sees in the list — they differ on purpose: a quest inserts as `quest#7` but
 * lists as its title, and a blob inserts as `blob:#3`.
 */
export interface WikiLinkSuggestion {
  key: string;
  kind: "folio" | "quest" | "blob";
  token: string;
  label: string;
  hint?: string;
}

export interface WikiLinkEditorContext {
  resolve: (body: string) => WikiLinkTarget | undefined;
  suggestions: WikiLinkSuggestion[];
  /** Follow a resolved reference. Never called for a broken one. */
  navigate: (href: string) => void;
}

/**
 * A stable box the editor reads the context out of, lazily.
 *
 * It is a ref and not a plain value because `MarkdownEditorInner` memoizes
 * its plugin array — deliberately, since a new array remounts Lexical and
 * loses the caret. A plugin parameter carrying the folio list directly would
 * therefore freeze at whatever the list was on first render. The same reason
 * `renderToolbarRef` exists in that file.
 */
export type WikiLinkContextRef = {
  current: WikiLinkEditorContext | undefined;
};

export const wikiLinkContextRef$ = Cell<WikiLinkContextRef | undefined>(
  undefined,
);

/**
 * Matches one complete `[[...]]` token. At least one inner character is
 * required: `[[]]` is not a reference and must stay ordinary text, or the
 * author would get a broken-link marker for a bracket pair they are still
 * in the middle of typing.
 */
const WIKI_LINK_RE = /\[\[[^[\]\n]+\]\]/;

const getWikiLinkMatch = (text: string): EntityMatch | null => {
  const match = WIKI_LINK_RE.exec(text);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
};

const hrefForToken = (token: string, ref: WikiLinkContextRef): string => {
  // `[[` + `]]` stripped — the resolver works on the inner text.
  const body = token.slice(2, -2);
  const target = ref.current?.resolve(body);
  // No context yet (the editor mounted before its project data landed) is
  // NOT the same as "resolves to nothing": marking it broken would paint
  // every reference red for a frame and, worse, would look like a real
  // diagnosis. An empty href renders as an undecorated token instead.
  return target?.href ?? "";
};

/**
 * Wiki-links inside the editor body: `[[Folio Title]]`, `[[#66]]`,
 * `[[quest#7]]`, `[[blob:#3]]`.
 *
 * Three pieces, all registered here:
 *
 *  1. `WikiLinkNode` — the token, decorated in place (see that file for why
 *     it is a `TextNode` and not a decorator).
 *  2. A Lexical text entity, which is what converts `[[…]]` typed by hand OR
 *     arriving from the imported markdown into that node, and — the part
 *     worth having a library for — converts it *back* to plain text the
 *     moment the author breaks the token by editing it.
 *  3. The `[[` typeahead, mounted as a composer child so it sits inside
 *     Lexical's own context.
 *
 * The plugin owns no data. Everything project-specific arrives through
 * `wikiLinkContextRef$` — see `WikiLinkContextRef` for why that indirection
 * is load-bearing rather than ceremony.
 */
export const wikiLinkPlugin = realmPlugin<{ contextRef: WikiLinkContextRef }>({
  init(realm, params) {
    const ref = params?.contextRef;
    if (!ref) return;
    realm.pub(wikiLinkContextRef$, ref);
    realm.pub(addLexicalNode$, WikiLinkNode);
    realm.pub(addComposerChild$, WikiLinkTypeahead);
    realm.pub(createRootEditorSubscription$, (editor: LexicalEditor) => {
      const onClick = (event: MouseEvent): void => {
        // Modifier-click, not plain click: inside a `contenteditable` a plain
        // click has to keep placing the caret, or the author cannot put their
        // cursor in the middle of a reference to fix it. Same bargain VS Code
        // and Obsidian strike.
        if (!event.metaKey && !event.ctrlKey) return;
        const el = event.target as HTMLElement | null;
        const anchor = el?.closest?.("[data-wiki-href]") as HTMLElement | null;
        const href = anchor?.getAttribute("data-wiki-href");
        if (!href || href.startsWith("lore-broken:")) return;
        event.preventDefault();
        ref.current?.navigate(href);
      };

      const unregister = [
        ...registerLexicalTextEntity(
          editor,
          getWikiLinkMatch,
          WikiLinkNode,
          (textNode: TextNode) => {
            const token = textNode.getTextContent();
            return $createWikiLinkNode(token, hrefForToken(token, ref));
          },
        ),
        // Keeps an existing node's target honest. `registerLexicalTextEntity`
        // only decides whether a node should still BE an entity — it has no
        // opinion about a payload it did not invent. Without this, editing
        // `[[#66]]` into `[[#67]]` in place would keep pointing at 66.
        editor.registerNodeTransform(WikiLinkNode, (node) => {
          if (!$isWikiLinkNode(node)) return;
          const href = hrefForToken(node.getTextContent(), ref);
          // Compare first: `setHref` marks the node dirty, and a transform
          // that dirties its own node unconditionally never settles.
          if (href !== node.getHref()) node.setHref(href);
        }),
        editor.registerRootListener((rootElement, prevRootElement) => {
          prevRootElement?.removeEventListener("click", onClick);
          rootElement?.addEventListener("click", onClick);
        }),
      ];

      return () => {
        for (const fn of unregister) fn();
      };
    });
  },
  update(realm, params) {
    if (params?.contextRef) realm.pub(wikiLinkContextRef$, params.contextRef);
  },
});
