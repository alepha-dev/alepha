/**
 * One short line of a body, fit for a ⌘K palette row: what every search
 * source shows under a hit's title.
 *
 * Markdown is flattened rather than rendered: the palette shows plain muted
 * text, and leaving `##` or `**` in would put syntax on screen. This is
 * intentionally cruder than the folio hover card's `stripMarkdown`: at ~140
 * characters the difference between a good strip and a rough one is
 * invisible, and the alternative is a second copy of that helper on the
 * server for no gain.
 */
export class SearchPreview {
  /**
   * Characters of body context a palette row shows. Enough for a sentence,
   * short enough that twelve of them do not outweigh the titles.
   */
  protected readonly MAX_PREVIEW = 140;

  public preview(raw: string | null | undefined): string | undefined {
    if (!raw) return undefined;
    const flat = raw
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`~[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!flat) return undefined;
    return flat.length > this.MAX_PREVIEW
      ? `${flat.slice(0, this.MAX_PREVIEW)}…`
      : flat;
  }
}
