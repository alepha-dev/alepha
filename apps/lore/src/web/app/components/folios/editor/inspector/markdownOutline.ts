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

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
const ATX = /^(#{1,6})\s+(.*)$/;
const SETEXT_H1 = /^\s{0,3}={2,}\s*$/;
const SETEXT_H2 = /^\s{0,3}-{2,}\s*$/;

/**
 * Strip the inline markdown a heading may carry so the outline shows the
 * words the reader sees. Deliberately shallow — headings rarely contain
 * anything beyond emphasis, code spans and links.
 *
 * Splits text into code-span and non-code-span segments, processes only
 * the non-code segments to remove emphasis, then rejoins. This protects
 * code contents from emphasis processing and avoids any placeholder collision.
 */
const stripInline = (raw: string): string => {
  // Split into segments: code spans (in backticks) and everything else
  const segments: Array<{ isCode: boolean; text: string }> = [];
  let lastIndex = 0;

  const codeRegex = /`([^`]*)`/g;
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex matching pattern
  while ((match = codeRegex.exec(raw)) !== null) {
    // Add non-code text before this code span
    if (match.index > lastIndex) {
      segments.push({ isCode: false, text: raw.slice(lastIndex, match.index) });
    }
    // Add the code span itself (without backticks)
    segments.push({ isCode: true, text: match[1] });
    lastIndex = match.index + match[0].length;
  }
  // Add remaining non-code text
  if (lastIndex < raw.length) {
    segments.push({ isCode: false, text: raw.slice(lastIndex) });
  }
  // If there were no code spans, add the whole text as non-code
  if (segments.length === 0) {
    segments.push({ isCode: false, text: raw });
  }

  // Process non-code segments to remove emphasis
  const processed = segments
    .map((seg) => {
      if (seg.isCode) return seg.text;
      let text = seg.text;
      text = text.replace(/\*\*([^*]*)\*\*/g, "$1");
      text = text.replace(/__([^_]*)__/g, "$1");
      // Single emphasis: * or _ must not be flanked by word characters
      text = text.replace(/(?<!\w)\*(?!\*)([^*]+)\*(?!\w)/g, "$1");
      text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");
      text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
      return text;
    })
    .join("");

  return processed.replace(/\s*#+\s*$/, "").trim();
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
    const openMatch = FENCE_OPEN.exec(line);
    const closeMatch = FENCE_CLOSE.exec(line);

    if (openMatch && !fence) {
      // Opening a new fence
      const marker = openMatch[1][0];
      const length = openMatch[1].length;
      fence = { marker, length };
      continue;
    }

    if (closeMatch && fence) {
      // Check if this closes the current fence
      const marker = closeMatch[1][0];
      const length = closeMatch[1].length;
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
