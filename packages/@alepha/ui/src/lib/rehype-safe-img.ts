/**
 * The attributes an `<img>` may carry through. Everything else — event
 * handlers, `style`, `class`, `srcset`, `usemap` — is dropped.
 */
const ALLOWED = new Set(["src", "alt", "title", "width", "height"]);

/**
 * One `<img …>` tag and nothing else: optional whitespace, the tag, its
 * attributes, an optional self-closing slash, and the end of the string.
 *
 * Anchored at both ends deliberately. A pattern that merely *found* an
 * `<img>` would accept `<img src="a"><script>…</script>` and promote the
 * whole raw node, carrying the script into the document as markup.
 */
const LONE_IMG = /^\s*<img\s+([^>]*?)\/?>\s*$/i;

/**
 * `name="value"`, `name='value'` or `name=value`.
 */
const ATTRIBUTE = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * A `src` this reader is willing to load.
 *
 * Allowed: a relative `assets/…` path (what folio content stores) and a
 * same-origin absolute path (`/api/files/…`). Nothing else — no `data:`,
 * no `javascript:`, no remote host, and no `//` protocol-relative URL,
 * which is a remote host wearing a local-looking prefix.
 */
const isSafeSrc = (src: string): boolean => {
  // Drop every C0 control character and space before looking for a scheme.
  // Browsers ignore them while parsing a URL, so a literal tab or newline
  // inside the attribute would otherwise walk `java\nscript:` past a naive
  // prefix check and still execute.
  //
  // Done by code point rather than by a regex character class: a class
  // spanning control characters is unreadable and linters reject it
  // outright. The bound says what it means.
  let stripped = "";
  for (const character of src) {
    if ((character.codePointAt(0) ?? 0) > 0x20) stripped += character;
  }
  const normalized = stripped.toLowerCase();
  if (!normalized) return false;
  if (normalized.includes(":")) return false;
  if (normalized.startsWith("//")) return false;
  // `..` would address something outside the folio's own assets.
  if (normalized.includes("..")) return false;
  return normalized.startsWith("assets/") || normalized.startsWith("/");
};

/**
 * Parse a raw HTML string into the attributes of a safe `<img>`, or
 * `undefined` if it is anything else.
 *
 * Exported and tested directly because this is the entire XSS surface of the
 * markdown reader: `MarkdownView` renders user-authored content and does NOT
 * use `rehype-raw`, so raw HTML is escaped to text everywhere except here.
 *
 * Deliberately string-based rather than `innerHTML`-based: this runs during
 * SSR where there is no DOM, and a parser that only ever produces an
 * allowlisted attribute bag cannot be tricked into producing a different
 * element.
 */
export const parseSafeImg = (
  html: string,
): Record<string, string> | undefined => {
  const match = LONE_IMG.exec(html);
  if (!match) return undefined;

  const attributes: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let found: RegExpExecArray | null = ATTRIBUTE.exec(match[1]);
  while (found) {
    const name = found[1].toLowerCase();
    const value = found[2] ?? found[3] ?? found[4] ?? "";
    if (ALLOWED.has(name)) {
      // `width`/`height` reach a DOM attribute, so only digits pass —
      // anything else is refused rather than handed over to be interpreted.
      if (name === "width" || name === "height") {
        if (/^\d+$/.test(value)) attributes[name] = value;
      } else {
        attributes[name] = value;
      }
    }
    found = ATTRIBUTE.exec(match[1]);
  }

  if (!attributes.src || !isSafeSrc(attributes.src)) return undefined;
  return attributes;
};

/**
 * Minimal shape of the hast nodes this plugin walks. Typed locally rather
 * than pulled from `@types/hast` — the package is not a dependency here, and
 * this is the whole of what the transform touches.
 */
interface RawNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: RawNode[];
}

/**
 * Promote `<img …>` raw HTML into a real element, and leave every other raw
 * node alone.
 *
 * ## Why not `rehype-raw`
 *
 * `rehype-raw` re-parses ALL raw HTML into elements, which is the correct
 * tool when the markdown is trusted. Folio content is written by users and
 * rendered to other project members, so enabling it would turn every
 * markdown surface in the app into an HTML injection point — against the
 * explicit posture of the rest of this codebase.
 *
 * This plugin is the narrow alternative: exactly one tag, an attribute
 * allowlist, and a `src` scheme check. It exists because MDXEditor
 * serialises a *resized* image as `<img width="600" src="…" />` (an
 * un-resized one stays plain `![alt](src)` markdown), so without it a resize
 * would render as escaped text.
 *
 * React-markdown converts any surviving raw node to a text node, so anything
 * this transform declines keeps the existing, safe behaviour.
 */
export const rehypeSafeImg = () => {
  const visit = (node: RawNode): void => {
    const children = node.children;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.type === "raw" && typeof child.value === "string") {
        const attributes = parseSafeImg(child.value);
        if (attributes) {
          children[i] = {
            type: "element",
            tagName: "img",
            properties: attributes,
            children: [],
          };
        }
        continue;
      }
      visit(child);
    }
  };

  return (tree: RawNode): void => visit(tree);
};
