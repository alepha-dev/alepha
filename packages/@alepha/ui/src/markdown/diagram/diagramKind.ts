/**
 * Which pipeline a ` ```mermaid ` fence belongs to, from its header line.
 *
 * The header is the first line that is not YAML frontmatter, a
 * `%%{init: …}%%` directive or a `%%` comment - mermaid allows all three
 * above it. Both parsers check their own header again, because both are
 * independently callable; this exists so an unsupported diagram type never
 * enters a parser at all.
 *
 * ⚠️ **Pure, and in its own file so it can be called from a server.** The
 * renderer is not the only caller any more: Lore checks the fences an agent
 * writes over MCP and warns in the tool result, which happens in a Worker
 * with no DOM and no React. Both sides have to agree on what "supported"
 * means, or the warning describes a different renderer than the one that
 * runs - so there is one function, not two.
 */
export const diagramKind = (
  source: string,
): "sequence" | "flowchart" | undefined => {
  const header = source
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/%%\{[\s\S]*?\}%%/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/%%.*$/, "").trim())
    .find(Boolean);

  if (!header) return undefined;
  if (/^sequenceDiagram\b/i.test(header)) return "sequence";
  if (/^(?:flowchart|graph)\b/i.test(header)) return "flowchart";
  return undefined;
};
