import {
  formatReference,
  mentionPattern,
  parseTypedReference,
  resolveMentionCapture,
} from "@lore/core/web";

// alepha-allow no-module-code: a plain helper module the page imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * A message body as the conversation renders it (#E161, #Q3929): the bare
 * `#Q12` a person types becomes core's `[[#Q12]]`, which `LoreViewer`
 * resolves to a link, and an `@handle` of a member becomes a mention link.
 *
 * A line break is kept as typed: a chat message is not a document, and
 * Shift+Enter means a new line, not a space.
 *
 * The server parsed the same body when it was written (`ChatMentionParser`)
 * and the two agree on what is held out: fenced blocks, code spans, an
 * existing `[[...]]` and a markdown link's target are left verbatim, so a
 * message explaining `#include` or an `@decorator` sprouts no link.
 */
export const chatMarkdown = (
  body: string,
  options: { projectSlug: string; members: Array<{ name: string }> },
): string =>
  body
    .split(/(```[\s\S]*?```|`[^`\n]*`|\[\[[^\]\n]*\]\]|\]\([^)\n]*\))/g)
    .map((text, index) =>
      index % 2 === 1
        ? text
        : hardBreaks(expandMentions(expandReferences(text), options)),
    )
    .join("");

// alepha-allow no-module-code: a plain helper module the page imports directly, not a DI service: no container builds it, so there is nothing to substitute
const expandReferences = (segment: string): string =>
  segment.replace(
    /(^|[^\w#/[])#([A-Za-z])(\d+)\b/g,
    (match, prefix: string, letter: string, id: string) => {
      const typed = parseTypedReference(`#${letter}${id}`);
      if (!typed) return match;
      return `${prefix}[[${formatReference(typed.kind, typed.id)}]]`;
    },
  );

// alepha-allow no-module-code: a plain helper module the page imports directly, not a DI service: no container builds it, so there is nothing to substitute
const expandMentions = (
  segment: string,
  options: { projectSlug: string; members: Array<{ name: string }> },
): string => {
  if (options.members.length === 0) return segment;
  return segment.replace(
    mentionPattern(),
    (match, prefix: string, capture: string) => {
      const resolved = resolveMentionCapture(capture, options.members);
      if (!resolved) return match;
      return `${prefix}[@${resolved.handle}](/${options.projectSlug}/settings/members)${resolved.trailing}`;
    },
  );
};

// alepha-allow no-module-code: a plain helper module the page imports directly, not a DI service: no container builds it, so there is nothing to substitute
const hardBreaks = (segment: string): string =>
  segment.replace(/([^\n])\n(?=[^\n])/g, "$1  \n");
