import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";

export type SerializedWikiLinkNode = Spread<
  { href: string },
  SerializedTextNode
>;

/**
 * A `[[...]]` reference inside the editor body.
 *
 * ## Why a TextNode subclass and not a DecoratorNode
 *
 * Quest #131 proposed a decorator node — a React component rendered in place
 * of the token, showing the resolved title. That is the right shape for a
 * READER (it is what `rewriteFolioWikiLinks` does for `MarkdownView`) and the
 * wrong one for an editor: a decorator replaces the token's text, so
 * `[[#66]]` would display as "Drizzle v1 plan" and the author would have no
 * way to see, select, or fix the reference they typed without deleting the
 * whole chip. Live-preview editors that do hide the source (Obsidian) pay for
 * it with caret-position machinery that expands the token back to source
 * whenever the cursor enters it — a large amount of very fiddly code whose
 * failure mode is eating the user's text.
 *
 * A TextNode subclass keeps the token as editable text and decorates it in
 * place: link colouring, the resolved target on `data-wiki-href`, a wavy
 * underline when it resolves to nothing. The markdown round-trip is then free
 * — MDXEditor's text export visitor is `testLexicalNode: $isTextNode`, which
 * a subclass satisfies, so the token serializes back byte-identical with no
 * export visitor of our own to keep in sync.
 *
 * ## `__`-prefixed field
 *
 * The house rule is no underscore prefixes on class members. Lexical is the
 * exception: it treats `__`-prefixed properties as node state for cloning and
 * reconciliation, and warns in development about own properties that are not
 * prefixed. `__href` is Lexical's convention, not ours.
 */
export class WikiLinkNode extends TextNode {
  /**
   * Where this reference points — a real path, or `lore-broken:<reason>`.
   * Computed by the resolver at the moment the node is created or its text
   * changes; nothing downstream re-derives it.
   */
  __href: string;

  static getType(): string {
    return "lore-wikilink";
  }

  static clone(node: WikiLinkNode): WikiLinkNode {
    return new WikiLinkNode(node.__text, node.__href, node.__key);
  }

  static importJSON(serialized: SerializedWikiLinkNode): WikiLinkNode {
    return $createWikiLinkNode(serialized.text, serialized.href).updateFromJSON(
      serialized,
    );
  }

  constructor(text: string, href: string, key?: NodeKey) {
    super(text, key);
    this.__href = href;
  }

  exportJSON(): SerializedWikiLinkNode {
    return { ...super.exportJSON(), href: this.__href };
  }

  getHref(): string {
    return this.getLatest().__href;
  }

  setHref(href: string): this {
    const self = this.getWritable();
    self.__href = href;
    return self;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    this.applyAttributes(dom);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const rebuilt = super.updateDOM(prevNode, dom, config);
    // `super.updateDOM` returning true means Lexical will throw this element
    // away and call `createDOM` again, which re-applies everything — so only
    // patch in place when it is keeping the element.
    if (!rebuilt) this.applyAttributes(dom);
    return rebuilt;
  }

  /**
   * A wiki-link is one indivisible token: typing at either edge must produce
   * ordinary text next to it, not extend the reference. Without this, a
   * character typed right after `]]` would join the node and the next
   * transform pass would have to tear it apart again mid-keystroke.
   */
  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  isTextEntity(): boolean {
    return true;
  }

  protected applyAttributes(dom: HTMLElement): void {
    const broken = this.__href.startsWith("lore-broken:");
    dom.className = broken
      ? "lore-wikilink lore-wikilink-broken"
      : "lore-wikilink";
    // Read by the click handler (to follow the link) and by
    // `WikiLinkHoverProvider` (to raise the preview card). The reader-side
    // markup uses `<a href>` for the same job; inside a `contenteditable`
    // an anchor is a liability — the browser gives it its own drag and
    // selection behaviour — so the target travels on a data attribute and
    // the hover provider accepts both.
    dom.setAttribute("data-wiki-href", this.__href);
  }
}

export const $createWikiLinkNode = (text: string, href: string): WikiLinkNode =>
  $applyNodeReplacement(new WikiLinkNode(text, href));

export const $isWikiLinkNode = (
  node: LexicalNode | null | undefined,
): node is WikiLinkNode => node instanceof WikiLinkNode;
