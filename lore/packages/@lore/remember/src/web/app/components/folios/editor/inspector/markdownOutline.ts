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
 * Uses U+0000 as a collision-proof sentinel: CommonMark requires null bytes
 * to be sanitized away before parsing, so the sentinel is guaranteed absent.
 * Extracts code spans to this sentinel, processes the whole string through
 * emphasis/link removal (sentinel is not `\w`, so word boundaries work across
 * code spans), then restores by consuming from a queue in order.
 */
const stripInline = (raw: string): string => {
  // CommonMark sanitization: U+0000 → U+FFFD, guaranteeing sentinel is absent
  let text = raw.replace(/\0/g, "�");

  // Extract code spans (handle multi-backtick delimiters per CommonMark)
  const codeQueue: string[] = [];
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_match, _delim) => {
    codeQueue.push(_match.slice(_delim.length, -_delim.length));
    return "\0";
  });

  // Process the whole string to remove emphasis and links
  text = text.replace(/\*\*([^*]*)\*\*/g, "$1");
  text = text.replace(/__([^_]*)__/g, "$1");
  // Single emphasis: * or _ must not be flanked by word characters to match
  text = text.replace(/(?<!\w)\*(?!\*)([^*]+)\*(?!\w)/g, "$1");
  text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Restore code spans by consuming from the queue in order
  let queueIndex = 0;
  text = text.replace(/\0/g, () => {
    return queueIndex < codeQueue.length ? codeQueue[queueIndex++] : "\0";
  });

  return text.replace(/\s*#+\s*$/, "").trim();
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
