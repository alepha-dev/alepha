/**
 * The markdown an attachment is referenced by: `![name](assets/<name>)`.
 *
 * One definition because there are two writers — the editor's upload handler
 * (`useFolioImageUpload`) and the Attachments tab's "copy reference" — and
 * one reader (`rewriteFolioWikiLinks`'s `assets/` pass). A reference that
 * disagrees with the reader by so much as an encoding rule produces a
 * broken-link marker on a file that is sitting right there in the panel, and
 * nothing else in the app would report it.
 *
 * Percent-encoded so a name containing a space or a parenthesis cannot
 * terminate the markdown URL early.
 */
export const folioAssetPath = (name: string): string =>
  // `encodeURIComponent` leaves parentheses alone — they are legal URI
  // sub-delimiters — but a bare `)` closes a markdown link, so they have to
  // go too. This is not a corner case: `FolioAttachmentService.autoSuffix`
  // produces `name (1).ext` for every name collision, so the commonest
  // generated name is precisely the one that breaks without this.
  `assets/${encodeURIComponent(name).replace(/\(/g, "%28").replace(/\)/g, "%29")}`;

/**
 * The full embed form, alt text included. An empty alt is an accessibility
 * hole, and the file's own name is the best label available at the moment
 * it is inserted.
 */
export const folioAssetEmbed = (name: string): string =>
  `![${name}](${folioAssetPath(name)})`;

/**
 * Every form a reference to attachment `name` may take in a document:
 * `](assets/<name>)` bare, percent-encoded, and in the `folioAssetPath`
 * form. The writers percent-encode, but hand-typed markdown will not.
 *
 * One list for the server's rewrite (an SQL `replace` per form) and the
 * editor's (the same over the open draft), so a rename cannot rewrite one
 * and leave the other pointing at the old name.
 */
export const folioAssetReferenceForms = (name: string): string[] =>
  [
    ...new Set([
      name,
      encodeURIComponent(name),
      folioAssetPath(name).slice("assets/".length),
    ]),
  ].map((form) => `](assets/${form})`);

/**
 * `content` with every reference to attachment `from` repointed at `to`.
 */
export const rewriteFolioAssetReferences = (
  content: string,
  from: string,
  to: string,
): string => {
  if (from === to) return content;
  const replacement = `](${folioAssetPath(to)})`;
  let next = content;
  for (const form of folioAssetReferenceForms(from)) {
    next = next.split(form).join(replacement);
  }
  return next;
};
