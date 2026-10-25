/**
 * Technical line drawings of the pieces, generated as SVG.
 *
 * ### Why drawings and not photographs
 *
 * A goldsmith draws a piece before casting it, and those drawings are the
 * atelier's own artefacts — precise, unglamorous, annotated. Using them as the
 * catalogue imagery is both honest for a demo with no photography and more
 * characteristic than any stock photograph would be.
 *
 * The stroke colour is baked in per piece rather than inherited: these are
 * uploaded to `alepha/api/files` and served as real files to `<img>`, which
 * cannot inherit `currentColor`. Baking it is also the point — the drawing is
 * stroked in *that piece's* metal, so the image states the metal.
 */
export class ShopDrawings {
  /**
   * 18-carat yellow gold, 750‰.
   */
  public static readonly OR_JAUNE = "#c9a227";
  /**
   * White gold / palladium, 750‰.
   */
  public static readonly OR_GRIS = "#b6bcc4";
  /**
   * Sterling silver, 925‰.
   */
  public static readonly ARGENT = "#96a3a8";

  /**
   * A pendant necklace: the chain hangs as a catenary, the drop is faceted.
   */
  public necklace(stroke: string): string {
    return this.wrap(
      stroke,
      `<path d="M40 46 C 40 150, 160 150, 160 46" />
       <path d="M40 46 a 4 4 0 1 0 0.1 0" />
       <path d="M160 46 a 4 4 0 1 0 0.1 0" />
       <!-- bail -->
       <path d="M100 141 v -8 a 7 7 0 1 1 0 0.1" />
       <!-- faceted drop: outline, table, two pavilion lines -->
       <path d="M100 148 L 118 172 L 100 212 L 82 172 Z" />
       <path d="M82 172 L 118 172" />
       <path d="M100 148 L 100 212" opacity="0.45" />`,
    );
  }

  /**
   * A ring in three-quarter view: outer and inner ellipse, band walls, and the
   * flat top face that carries an engraving.
   */
  public ring(stroke: string, options: { engraved?: boolean } = {}): string {
    return this.wrap(
      stroke,
      `<ellipse cx="100" cy="132" rx="62" ry="24" />
       <ellipse cx="100" cy="132" rx="47" ry="16" opacity="0.55" />
       <!-- band walls, drawn as the visible front arc thickened -->
       <path d="M38 132 a 62 24 0 0 0 124 0" />
       <path d="M38 132 v -14 a 62 24 0 0 1 124 0 v 14" />
       <path d="M53 118 a 47 16 0 0 0 94 0" opacity="0.55" />
       ${
         options.engraved
           ? `<!-- the engraved face: a scribed panel with three struck lines -->
              <path d="M74 104 h 52" opacity="0.9" />
              <path d="M79 96 h 42" opacity="0.6" />
              <path d="M85 88 h 30" opacity="0.35" />`
           : ""
       }`,
    );
  }

  /**
   * A ring with a bezel-set stone, seen from the front so the band reads as a
   * band.
   *
   * The first attempt stacked a tall bezel and a large brilliant above a
   * flattened ellipse, and the result looked like a wax seal on a stamp rather
   * than a ring. Two changes fixed it: the hoop is drawn as a near-circle rather
   * than a squashed ellipse, and the stone is small and sits *on* the hoop rather
   * than floating above it — which is also how the piece is actually made.
   */
  public ringWithStone(stroke: string): string {
    return this.wrap(
      stroke,
      `<!-- the hoop, seen face on: two concentric circles make a band -->
       <circle cx="100" cy="140" r="52" />
       <circle cx="100" cy="140" r="42" opacity="0.55" />
       <!-- the setting sits on the hoop, breaking its outline -->
       <path d="M86 92 h 28 l -3 -10 h -22 Z" />
       <!-- the stone: girdle and table, small enough to read as 4 mm -->
       <circle cx="100" cy="74" r="12" />
       <path d="M93 68 h 14 l 4 6 h -22 Z" />
       <path d="M93 68 L 89 74" opacity="0.5" />
       <path d="M107 68 L 111 74" opacity="0.5" />`,
    );
  }

  /**
   * A linked bracelet: rectangular links, curving as it would lie on a bench.
   */
  public bracelet(stroke: string): string {
    const links = Array.from({ length: 7 }, (_, i) => {
      const x = 24 + i * 22;
      // A shallow arc so it reads as lying flat rather than pinned straight.
      const y = 118 + Math.sin((i / 6) * Math.PI) * -14;
      return `<rect x="${x}" y="${y.toFixed(1)}" width="18" height="26" rx="0" />
              <path d="M${x + 4} ${(y + 8).toFixed(1)} h 10" opacity="0.4" />`;
    }).join("");
    return this.wrap(stroke, links);
  }

  /**
   * Drop earrings: a hook and two discs, one eclipsing the other.
   */
  public earrings(stroke: string): string {
    const one = (cx: number) => `
      <path d="M${cx} 62 a 9 9 0 1 1 0.1 0 v 10" />
      <circle cx="${cx}" cy="106" r="22" />
      <circle cx="${cx + 9}" cy="114" r="22" opacity="0.45" />`;
    return this.wrap(stroke, `${one(66)}${one(136)}`);
  }

  /**
   * The gift card: a plate carrying the atelier's own mark.
   */
  public giftCard(stroke: string): string {
    return this.wrap(
      stroke,
      `<rect x="34" y="78" width="132" height="84" />
       <path d="M34 100 h 132" opacity="0.5" />
       <!-- the maker's lozenge, struck on the plate -->
       <path d="M100 116 L 118 128 L 118 146 L 100 158 L 82 146 L 82 128 Z" />
       <path d="M92 132 h 16" opacity="0.7" />
       <path d="M92 140 h 16" opacity="0.7" />`,
    );
  }

  /**
   * Common frame: a square viewBox, hairline strokes, no fill. The stroke width
   * stays constant across drawings so the whole catalogue reads as one hand.
   */
  protected wrap(stroke: string, body: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" role="img">
  <g fill="none" stroke="${stroke}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>`;
  }
}
