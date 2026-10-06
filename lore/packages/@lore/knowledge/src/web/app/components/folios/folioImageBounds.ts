/**
 * Widest a folio attachment is ever displayed, in pixels.
 *
 * Every upload path downscales to this before the bytes leave the browser:
 * the editor's image button, a ⌘V paste (MDXEditor routes clipboard images
 * through the same handler), and the Attachments panel.
 *
 * One definition rather than one per entry point, because a folio whose
 * images differ in size depending on how they were added would be a bug
 * with no visible cause — and a comment saying "keep these in sync" is what
 * that bug looks like the day before it happens.
 *
 * 1600 rather than the 256 the project logo uses: a folio image renders at
 * the document's full prose measure (~812px), so this is roughly 2x for
 * retina and nothing beyond it is ever seen.
 */
export const FOLIO_IMAGE_MAX_WIDTH = 1600;
