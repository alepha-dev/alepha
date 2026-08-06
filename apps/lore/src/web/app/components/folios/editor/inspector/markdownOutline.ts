/**
 * One heading extracted from a folio's markdown, in document order.
 */
export interface FolioOutlineHeading {
  /**
   * Heading depth, 1 through 6.
   */
  level: number;
  /**
   * Visible heading text with inline markdown syntax removed.
   */
  text: string;
  /**
   * 0-based position among all headings in the document. The inspector
   * uses it to address the matching `h1…h6` element in the editor's
   * contenteditable — the Nth heading in the source is the Nth heading
   * element in the DOM.
   */
  index: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX = /^(#{1,6})\s+(.*)$/;
const SETEXT_H1 = /^\s{0,3}={2,}\s*$/;
const SETEXT_H2 = /^\s{0,3}-{2,}\s*$/;

/**
 * Strip the inline markdown a heading may carry so the outline shows the
 * words the reader sees. Deliberately shallow — headings rarely contain
 * anything beyond emphasis, code spans and links.
 *
 * Protects code spans from emphasis processing by extracting them to
 * placeholders first, and uses word-boundary checks on emphasis markers
 * so intra-word underscores (e.g., `LOG_FORMAT`) survive intact.
 */
const stripInline = (raw: string): string => {
  // Extract code spans to protect them from emphasis processing
  const codeSpans: string[] = [];
  let protected_ = raw.replace(/`([^`]*)`/g, (_, content) => {
    codeSpans.push(content);
    return `⟨${codeSpans.length - 1}⟩`;
  });

  // Strip emphasis with word-boundary checks so intra-word underscores survive
  protected_ = protected_
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    // Single emphasis: * or _ must not be flanked by word characters to match
    .replace(/(?<!\w)\*(?!\*)([^*]+)\*(?!\w)/g, "$1")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*#+\s*$/, "")
    .trim();

  // Restore code spans
  protected_ = protected_.replace(/⟨(\d+)⟩/g, (_, index) => {
    return codeSpans[Number(index)];
  });

  return protected_;
};

/**
 * Parse a folio's markdown into its heading outline.
 *
 * Fenced code blocks are skipped so a `# comment` inside a shell block
 * never becomes a heading — that is the single most common false
 * positive in this codebase's own folios.
 */
export const markdownOutline = (markdown: string): FolioOutlineHeading[] => {
  const lines = markdown.split(/\r?\n/);
  const headings: FolioOutlineHeading[] = [];
  let fence: { marker: string; length: number } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const length = fenceMatch[1].length;
      if (!fence) {
        fence = { marker, length };
        continue;
      }
      // Only close a fence if marker matches AND length is at least as long as the opener
      if (fence.marker === marker && length >= fence.length) {
        fence = undefined;
        continue;
      }
    }
    if (fence) continue;

    const atx = ATX.exec(line);
    if (atx) {
      const text = stripInline(atx[2]);
      if (text) {
        headings.push({
          level: atx[1].length,
          text,
          index: headings.length,
        });
      }
      continue;
    }

    // Setext: the underline is on the NEXT line, so look back one.
    const previous = lines[i - 1];
    if (!previous?.trim() || ATX.test(previous)) continue;
    const level = SETEXT_H1.test(line) ? 1 : SETEXT_H2.test(line) ? 2 : 0;
    if (!level) continue;
    const text = stripInline(previous);
    if (text) {
      headings.push({ level, text, index: headings.length });
    }
  }

  return headings;
};
