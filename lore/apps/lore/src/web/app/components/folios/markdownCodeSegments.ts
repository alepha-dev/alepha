/**
 * One markdown segment, tagged with whether it is code.
 */
export interface MarkdownSegment {
  /** The verbatim slice. Concatenating every `text` reproduces the input. */
  text: string;
  /** True for a fenced block (fence lines included) or an inline code span. */
  code: boolean;
}

/**
 * Split markdown into code and non-code segments, losslessly.
 *
 * Exists because every display-time rewrite Lore runs over markdown is a
 * regex over the raw string, and a regex has no idea what a code fence is.
 * `rewriteFolioWikiLinks` used to turn `const a = [[1, 2]];` inside a
 * ```ts block into a broken-link marker, visibly, inside the `<pre>` (#1261).
 * A mermaid `A[[Sub]]` node was corrupted the same way, which is fatal once
 * a fence is a diagram rather than decoration.
 *
 * Concatenating the segments returns the input byte for byte, so a caller
 * rewrites the prose segments and reassembles without a second parser.
 *
 * ## What counts as code
 *
 * Fenced blocks (backtick and tilde, any fence length from three up, any
 * indentation so a fence inside a list item still counts) including their
 * own fence lines, and inline code spans with matching backtick runs. An
 * unterminated fence runs to the end of the document, which is what a
 * markdown renderer does with it too.
 *
 * Four-space indented code blocks are NOT detected: telling one from a list
 * continuation needs real block parsing, and nothing in Lore writes them.
 */
export const splitMarkdownCode = (input: string): MarkdownSegment[] => {
  const segments: MarkdownSegment[] = [];
  const push = (text: string, code: boolean) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.code === code) last.text += text;
    else segments.push({ text, code });
  };

  const lines = input.split("\n");
  let fence: { char: string; length: number } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const newline = i < lines.length - 1 ? "\n" : "";

    if (fence) {
      push(line + newline, true);
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      // A closing fence has to be at least as long as the opening one, so a
      // ```` block can contain a ``` line.
      if (
        closing &&
        closing[1][0] === fence.char &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const opening = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    // A backtick fence's info string may not itself contain a backtick;
    // otherwise `` ```a`b `` would open a block that never closes.
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = { char: opening[1][0], length: opening[1].length };
      push(line + newline, true);
      continue;
    }

    for (const part of splitInlineCode(line)) push(part.text, part.code);
    push(newline, false);
  }

  return segments;
};

/**
 * Run `fn` over the prose of `input`, leaving code untouched, and
 * reassemble. The shape every rewrite pass in Lore wants.
 */
export const outsideMarkdownCode = (
  input: string,
  fn: (segment: string) => string,
): string =>
  splitMarkdownCode(input)
    .map((s) => (s.code ? s.text : fn(s.text)))
    .join("");

/**
 * Split one line on inline code spans.
 *
 * A span opens on a run of N backticks and closes on the next run of
 * EXACTLY N, which is what lets ``` ``a ` b`` ``` hold a backtick. A run with
 * no matching close is not a span and stays prose.
 */
const splitInlineCode = (line: string): MarkdownSegment[] => {
  const out: MarkdownSegment[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    const openEnd = runEnd(line, i);
    const length = openEnd - i;

    let closeStart = -1;
    let closeEnd = openEnd;
    let j = openEnd;
    while (j < line.length) {
      if (line[j] !== "`") {
        j++;
        continue;
      }
      const end = runEnd(line, j);
      if (end - j === length) {
        closeStart = j;
        closeEnd = end;
        break;
      }
      j = end;
    }

    if (closeStart === -1) {
      // Not a span: skip past the run so its backticks are not reconsidered
      // as an opener on the next pass.
      i = openEnd;
      continue;
    }

    if (i > plainStart)
      out.push({ text: line.slice(plainStart, i), code: false });
    out.push({ text: line.slice(i, closeEnd), code: true });
    plainStart = closeEnd;
    i = closeEnd;
  }

  if (plainStart < line.length)
    out.push({ text: line.slice(plainStart), code: false });
  return out;
};

/**
 * Index just past the run of backticks starting at `start`.
 */
const runEnd = (line: string, start: number): number => {
  let end = start;
  while (end < line.length && line[end] === "`") end++;
  return end;
};
