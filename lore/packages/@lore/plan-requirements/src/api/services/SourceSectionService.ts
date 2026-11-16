/**
 * One section of a specification folio, found by its heading's slug.
 */
export interface SourceSection {
  anchor: string;
  heading: string;
  level: number;
  /**
   * The text under the heading, to the next heading of the same or a higher
   * level, trimmed.
   */
  text: string;
}

/**
 * The section comparison behind Source changed (#E153, #Q3769): a
 * requirement names its source by a folio and the slug of a heading in it
 * (the `#anchor` a heading link uses). Given two bodies and an anchor, this
 * says whether that section's text moved, or whether the heading is gone.
 *
 * Pure: it reads no table, so it is specified on its own.
 */
export class SourceSectionService {
  protected static readonly FENCE = /^\s{0,3}(`{3,}|~{3,})/;
  protected static readonly ATX = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

  /**
   * A heading's slug, GitHub style: lowercased, punctuation dropped, spaces
   * to dashes. `3.2 Promo codes!` is `32-promo-codes`.
   */
  public slug(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[`*_~[\]()]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  /**
   * Every heading of a body as a section, in order.
   */
  public sections(body: string): SourceSection[] {
    const lines = body.split("\n");
    const heads: Array<{ line: number; level: number; heading: string }> = [];
    let fence: string | undefined;
    lines.forEach((line, index) => {
      const fenceMatch = SourceSectionService.FENCE.exec(line);
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1][0];
        else if (fenceMatch[1][0] === fence) fence = undefined;
        return;
      }
      if (fence) return;
      const match = SourceSectionService.ATX.exec(line);
      if (match) {
        heads.push({ line: index, level: match[1].length, heading: match[2] });
      }
    });
    const seen = new Map<string, number>();
    return heads.map((head, i) => {
      const end =
        heads.slice(i + 1).find((next) => next.level <= head.level)?.line ??
        lines.length;
      const base = this.slug(head.heading);
      // A repeated heading takes `-1`, `-2`, as heading links do.
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return {
        anchor: count ? `${base}-${count}` : base,
        heading: head.heading,
        level: head.level,
        text: lines
          .slice(head.line + 1, end)
          .join("\n")
          .trim(),
      };
    });
  }

  /**
   * The section an anchor names, or `undefined` when no heading has it.
   */
  public section(body: string, anchor: string): SourceSection | undefined {
    return this.sections(body).find((it) => it.anchor === anchor);
  }

  /**
   * How a section moved between the synced text and the current body:
   * `unchanged`, `edited`, or `removed` when its heading is gone.
   */
  public compare(
    synced: string,
    current: string,
    anchor: string,
  ): "unchanged" | "edited" | "removed" {
    const now = this.section(current, anchor);
    if (!now) return "removed";
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
    return normalize(now.text) === normalize(synced) ? "unchanged" : "edited";
  }
}
