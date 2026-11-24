/**
 * `{{name}}` or `{{arg.field}}`, whitespace inside the braces tolerated.
 */
const PROMPT_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\s*\}\}/g;

/**
 * Render a prompt's text against its values (#Q4274): the project's
 * placeholders and each arg's fields, keyed `project`, `epic.title`...
 *
 * The rules of `renderPromptTemplate` are kept:
 * - **one pass**, so a placeholder arriving inside a value (a quest titled
 *   `Fix {{epic.url}}`) is never expanded;
 * - **an allowlist**: only a key the caller put in `values` is substituted,
 *   and an unknown placeholder is left as it was written, never emptied.
 */
export const renderPromptText = (
  text: string,
  values: Record<string, string | number>,
): string =>
  text.replace(PROMPT_PLACEHOLDER, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );

/**
 * The placeholders a text names, `epic.title` or `project`, in order and
 * once each: what saving a custom prompt checks against its args.
 */
export const promptPlaceholders = (text: string): string[] => [
  ...new Set([...text.matchAll(PROMPT_PLACEHOLDER)].map((it) => it[1]!)),
];
