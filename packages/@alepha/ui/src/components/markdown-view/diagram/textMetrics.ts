import type { GraphNode } from "./graphModel.ts";

/**
 * The font the diagram pins, and never inherits.
 *
 * Inheriting is the trap: folio view mode and the quest description set
 * prose in Literata at 16.5px and load it lazily after first paint, while
 * every other surface is Inter at `text-sm`. An SVG that inherits would
 * measure against one face and render in another, differently per surface,
 * and shift when the font file lands. So the emitter sets both explicitly
 * and the table below is generated against exactly this face and size.
 *
 * `@alepha/ui` ships Inter through `@fontsource-variable/inter`; the stack
 * degrades to the platform UI sans if it has not loaded.
 */
export const DIAGRAM_FONT_FAMILY =
  '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

/** The one size every diagram label is drawn at. */
export const DIAGRAM_FONT_SIZE = 13;

/** Baseline-to-baseline distance, as a multiple of the font size. */
export const DIAGRAM_LINE_HEIGHT = 1.35;

/**
 * The widest a label may measure before it wraps, in pixels at
 * `DIAGRAM_FONT_SIZE`. Without a clamp a 400-character label produces a
 * 4000px box and every other node in the diagram becomes a speck.
 */
export const MAX_LABEL_WIDTH = 220;

/** How many lines a label keeps before the rest is cut with an ellipsis. */
export const MAX_LABEL_LINES = 8;

/**
 * Per-character advance widths for Inter, as a RATIO of the font size, so
 * the table scales to any size.
 *
 * ## How this was produced, and how to reproduce it
 *
 * `scripts/measure-font.mjs` loads the real `@fontsource-variable/inter`
 * woff2 into Chromium via Playwright, waits for `document.fonts.ready` and
 * calls `canvas.measureText` on every character below, then buckets them by
 * rounded ratio. Run it from the repo root and paste the output back here:
 *
 *     node packages/@alepha/ui/scripts/measure-font.mjs
 *
 * The numbers are NOT magic and NOT hand-tuned. If the pinned face or size
 * ever changes, regenerate rather than nudging a value.
 *
 * ## Why a table at all
 *
 * Layout needs node sizes before it can place anything, and node width comes
 * from the label. Mermaid gets this by rendering into a hidden DOM node,
 * which is precisely why mermaid cannot run without a browser. Arithmetic
 * keeps the layout core a pure function. It is an approximation: 5% off on a
 * box width is invisible in a boxes-and-arrows diagram, and it is the
 * concrete reason v1 is flowcharts rather than sequence diagrams, whose
 * layout is far more sensitive to text metrics.
 */
const WIDTH_BUCKETS: Array<[ratio: number, chars: string]> = [
  [0.242, "ijl"],
  [0.261, "’"],
  [0.269, "I"],
  [0.281, " "],
  [0.288, "!,.:·"],
  [0.3, "'"],
  [0.302, ";"],
  [0.323, "`"],
  [0.327, "t"],
  [0.333, "|"],
  [0.36, "/\\"],
  [0.365, "()[]"],
  [0.37, "f"],
  [0.376, "r"],
  [0.407, "1"],
  [0.426, "{}"],
  [0.44, "“”"],
  [0.456, "_"],
  [0.46, "-"],
  [0.466, '"'],
  [0.471, "^"],
  [0.501, "*"],
  [0.511, "?"],
  [0.528, "s"],
  [0.546, "x"],
  [0.549, "k"],
  [0.552, "z"],
  [0.562, "avyà"],
  [0.565, "L"],
  [0.566, "7"],
  [0.571, "Jcç"],
  [0.583, "eéè"],
  [0.59, "F"],
  [0.591, "hnuüñ"],
  [0.593, "5"],
  [0.6, "oö"],
  [0.601, "E"],
  [0.61, "2"],
  [0.612, "bdpq"],
  [0.613, "g"],
  [0.618, "3"],
  [0.619, "8"],
  [0.62, "69"],
  [0.629, "Z"],
  [0.631, "0"],
  [0.633, "#"],
  [0.639, "P"],
  [0.642, "$S"],
  [0.644, "&R"],
  [0.646, "4T"],
  [0.654, "B"],
  [0.662, "+<=>~"],
  [0.672, "K"],
  [0.679, "Y"],
  [0.682, "X"],
  [0.69, "AV"],
  [0.722, "D"],
  [0.73, "C"],
  [0.743, "H"],
  [0.744, "U"],
  [0.746, "G"],
  [0.753, "N"],
  [0.765, "OQ"],
  [0.818, "w"],
  [0.864, "…"],
  [0.876, "m"],
  [0.903, "M"],
  [0.966, "@"],
  [0.982, "%"],
  [0.985, "W"],
  [1, "→←—"],
];

/**
 * Anything unlisted (CJK, emoji, the rest of Unicode) measures at the
 * average of the table. Wrong, but bounded, which is the whole contract.
 */
const FALLBACK_RATIO = 0.57;

const RATIOS: Map<string, number> = new Map(
  WIDTH_BUCKETS.flatMap(([ratio, chars]) =>
    // Width buckets are ASCII characters; there is nothing multi-unit to split.
    // oxlint-disable-next-line typescript/no-misused-spread
    [...chars].map((char) => [char, ratio] as [string, number]),
  ),
);

/**
 * The rendered width of one line, in pixels, at `fontSize`.
 */
export const measureLine = (line: string, fontSize: number): number => {
  let ratio = 0;
  for (const char of line) ratio += RATIOS.get(char) ?? FALLBACK_RATIO;
  return ratio * fontSize;
};

export interface LabelMetrics {
  /** The widest line, in pixels. */
  width: number;
  /** Total height of the line box stack, in pixels. */
  height: number;
  /** The lines as measured - wrapped and capped, so the emitter draws these. */
  lines: string[];
}

/**
 * Measure a node or cluster label, wrapping and clamping it first.
 *
 * Returns the lines it actually measured, not the ones it was given: the
 * emitter must draw exactly what was measured, or text and box disagree.
 */
export const measureLabel = (
  lines: string[],
  fontSize: number = DIAGRAM_FONT_SIZE,
): LabelMetrics => {
  const wrapped: string[] = [];
  for (const line of lines) {
    for (const piece of wrapLine(line, fontSize)) {
      wrapped.push(piece);
      if (wrapped.length >= MAX_LABEL_LINES) break;
    }
    if (wrapped.length >= MAX_LABEL_LINES) break;
  }

  const cut =
    wrapped.length >= MAX_LABEL_LINES &&
    countWrapped(lines, fontSize) > MAX_LABEL_LINES;
  if (cut)
    wrapped[MAX_LABEL_LINES - 1] = truncate(
      wrapped[MAX_LABEL_LINES - 1],
      fontSize,
    );

  const measured = wrapped.length > 0 ? wrapped : [""];
  return {
    width: Math.max(
      ...measured.map((line) => measureLine(line, fontSize)),
      fontSize,
    ),
    height: measured.length * fontSize * DIAGRAM_LINE_HEIGHT,
    lines: measured,
  };
};

/**
 * The box a node needs: its label plus padding, per shape.
 */
export const measureNode = (
  node: Pick<GraphNode, "lines" | "shape">,
  fontSize: number = DIAGRAM_FONT_SIZE,
): LabelMetrics => {
  const label = measureLabel(node.lines, fontSize);

  if (node.shape === "circle") {
    // An axis-aligned w x h box fits an ellipse exactly when
    // (w/2 / rx)^2 + (h/2 / ry)^2 <= 1, and rx = (w/2)·√2, ry = (h/2)·√2 is
    // the solution that touches all four corners. Forcing width === height
    // instead is what turned a two-word label into an enormous disc that
    // made every other node in the diagram a speck.
    const width = label.width * Math.SQRT2 + 12;
    const height = label.height * Math.SQRT2 + 12;
    return {
      // A one-line label is far wider than it is tall, so without a floor
      // the "circle" degenerates into a flat sliver.
      width,
      height: Math.max(height, width * 0.55),
      lines: label.lines,
    };
  }

  // A diamond has to be wide enough that its slanted sides clear the text.
  const padX = node.shape === "diamond" ? 34 : 16;
  const padY = node.shape === "diamond" ? 20 : 10;
  return {
    width: label.width + padX * 2,
    height: label.height + padY * 2,
    lines: label.lines,
  };
};

/**
 * Break one line to fit `MAX_LABEL_WIDTH`, at spaces where there are any.
 */
const wrapLine = (line: string, fontSize: number): string[] => {
  if (measureLine(line, fontSize) <= MAX_LABEL_WIDTH) return [line];

  const out: string[] = [];
  let current = "";
  for (const word of line.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureLine(candidate, fontSize) > MAX_LABEL_WIDTH) {
      out.push(current);
      current = word;
      continue;
    }
    current = candidate;
  }
  if (current) out.push(current);

  // A single word wider than the cap cannot be wrapped, only cut.
  return out.map((piece) =>
    measureLine(piece, fontSize) > MAX_LABEL_WIDTH
      ? truncate(piece, fontSize)
      : piece,
  );
};

/**
 * How many lines the label WOULD take unwrapped-capped, so a label that
 * exactly fills the cap is not marked as cut.
 */
const countWrapped = (lines: string[], fontSize: number): number =>
  lines.reduce((total, line) => total + wrapLine(line, fontSize).length, 0);

const truncate = (line: string, fontSize: number): string => {
  const ellipsis = measureLine("\u2026", fontSize);
  let out = "";
  for (const char of line) {
    if (measureLine(out + char, fontSize) + ellipsis > MAX_LABEL_WIDTH) break;
    out += char;
  }
  return `${out}\u2026`;
};
