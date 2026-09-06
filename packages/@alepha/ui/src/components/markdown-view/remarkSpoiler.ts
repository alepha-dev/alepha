/**
 * Discord's `||spoiler||`, as a remark plugin.
 *
 * Rewrites every `||…||` pair in the tree into one node that
 * `mdast-util-to-hast` renders as `<span data-spoiler="true">`, which
 * `MarkdownView` then maps onto `SpoilerSpan`. Everything between the markers
 * keeps its own markup: `||see [the docs](/d) **now**||` hides a link and a
 * bold word, not the text of them.
 *
 * ## ⚠️ It has to span SIBLINGS, not split one text node
 *
 * The obvious version splits a text node on `/\|\|([\s\S]+?)\|\|/` and fails on
 * exactly one case - markdown INSIDE the spoiler. Once emphasis has split the
 * paragraph, the opening `||` and its closer live in different mdast siblings,
 * so no regex over a single node can see both. This walk opens a collector on
 * the first marker, pushes the following siblings into it, and closes on the
 * next one.
 *
 * That shape is also what makes two things true for free rather than by a
 * special case that could rot:
 *
 * - **`code` and `inlineCode` stay literal.** Both carry a `value` and no
 *   `children`, so a text walk cannot reach inside them. `` `||x||` `` and a
 *   fenced block are structurally out of range.
 * - **A pair cannot cross a paragraph break.** Each parent's children are
 *   processed on their own, and the collector is discarded at the end of the
 *   list, so an unterminated `||` puts its literal text back and gives up.
 *
 * GFM table pipes are untouched for the same reason: by the time this runs,
 * `remark-gfm` has already turned `| a | b |` into rows and cells, and the
 * pipes are structure rather than text.
 *
 * ## ⚠️ It is not a security feature, and must never be presented as one
 *
 * The text sits in the DOM, in the raw markdown, in a folio export, in
 * `folio_get` over MCP and in any search snippet. It hides a plot point from a
 * reader's eye and nothing more.
 *
 * No new dependency: the walk is a plain recursion, so `unist-util-visit`
 * never enters `package.json` and `check:deps` stays quiet.
 */
const MARKER = "||";

/**
 * The subset of a mdast node this walk touches.
 *
 * Declared here rather than imported from `mdast`: the plugin needs "has
 * children" and "is a text node with a value", and nothing else. Taking the
 * real union would pull `@types/mdast` into this package's direct types for a
 * pair of structural checks.
 */
interface SpoilerNode {
  type: string;
  value?: string;
  children?: SpoilerNode[];
  data?: Record<string, unknown>;
}

export const remarkSpoiler = () => (tree: SpoilerNode) => {
  walk(tree);
};

/**
 * Rewrite this node's children, then descend into whatever survives.
 */
const walk = (node: SpoilerNode): void => {
  if (!node.children) return;
  node.children = rewrite(node.children);
  for (const child of node.children) {
    walk(child);
  }
};

/**
 * One sibling list, with every `||…||` pair folded into a spoiler node.
 */
const rewrite = (children: SpoilerNode[]): SpoilerNode[] => {
  // Nothing to do unless a marker is actually present at this level. The
  // common case is every paragraph in every document, so it is worth the
  // scan: without it, each one is rebuilt into a new array for nothing.
  if (
    !children.some(
      (child) => child.type === "text" && child.value?.includes(MARKER),
    )
  ) {
    return children;
  }

  const out: SpoilerNode[] = [];
  let open: SpoilerNode[] | undefined;
  const target = () => open ?? out;

  const push = (child: SpoilerNode) => {
    target().push(child);
  };

  const text = (value: string) => {
    if (value) push({ type: "text", value });
  };

  const toggle = () => {
    if (open) {
      out.push(spoiler(open));
      open = undefined;
      return;
    }
    open = [];
  };

  for (const child of children) {
    if (child.type !== "text" || !child.value?.includes(MARKER)) {
      push(child);
      continue;
    }

    // `split` gives one more segment than there are markers, so segment 0 is
    // whatever preceded the first one and every later segment is preceded by
    // a toggle.
    const segments = child.value.split(MARKER);
    text(segments[0]!);
    for (const segment of segments.slice(1)) {
      toggle();
      text(segment);
    }
  }

  if (open) {
    // Unterminated: the marker was never a spoiler, so it goes back as the
    // two characters the author typed, followed by everything that had been
    // collected behind it. Swallowing the rest of the paragraph instead is
    // what a lazy regex does, and it is the failure a reader cannot explain.
    out.push({ type: "text", value: MARKER }, ...open);
  }

  return out;
};

/**
 * One spoiler, as the node `mdast-util-to-hast` turns into a `<span>`.
 *
 * `hName` / `hProperties` are the documented way to place an element the
 * markdown AST has no type for: the default unknown-node handler builds a
 * `div` from the children and `applyData` then renames it and merges the
 * properties, so nothing invalid is ever produced inside a paragraph.
 */
const spoiler = (children: SpoilerNode[]): SpoilerNode => ({
  type: "spoiler",
  children,
  data: { hName: "span", hProperties: { "data-spoiler": "true" } },
});
