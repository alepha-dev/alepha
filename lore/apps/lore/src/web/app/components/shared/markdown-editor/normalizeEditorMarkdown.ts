/**
 * Post-process the markdown MDXEditor serializes back out.
 *
 * The WYSIWYG layer escapes characters it considers markdown-significant,
 * which corrupts Lore-specific syntax that must survive verbatim:
 *
 * - Wiki-links: `[[Folio Title]]`, `[[#12]]`, `[[quest#5]]`, `[[blob#3]]`
 *   come back as `\[\[Folio Title]]` — `FolioLinkService` then stops
 *   matching them, silently dropping the campaign's link graph on the
 *   next save.
 *
 * Applied on every editor change (cheap, pure string work) so callers
 * always see canonical Lore markdown.
 */
export const normalizeEditorMarkdown = (markdown: string): string => {
  let out = markdown;

  // `\[\[target]]` / `\[\[target\]\]` → `[[target]]`. The editor escapes
  // opening brackets individually; be liberal in what we repair.
  out = out.replace(
    /\\?\[\\?\[([^[\]\\\n]+)\\?\]\\?\]/g,
    (_match, inner: string) => `[[${inner}]]`,
  );

  return out;
};
