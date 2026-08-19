const removeHtmlTags = (text: string) => text.replace(/<[^>]*>/g, "");

/**
 * Turn a markdown description into a one-line snippet.
 *
 * Descriptions are markdown, so the raw first line is often `## Symptom`
 * or a fence rather than a sentence. Take the first line that carries
 * prose, then strip the inline syntax so the row reads as text and not
 * as source. Truncation itself is left to CSS — see the callers.
 *
 * Shared by `ProjectQuestsTable.tsx` (quest description) and
 * `ProjectSettingsAreasPage.tsx` (area description) — both fields are
 * `size: "rich"` markdown edited through a plain textarea, so both need
 * the same source-to-prose reduction rather than a second hand-rolled
 * variant.
 */
export const descriptionSnippet = (description: string) => {
  const line = removeHtmlTags(description)
    .split("\n")
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length > 0 &&
        !l.startsWith("#") &&
        !l.startsWith("```") &&
        !l.startsWith("---") &&
        !l.startsWith("|"),
    );

  return (line ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/^[>*+-]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/[*_`~]/g, "");
};
