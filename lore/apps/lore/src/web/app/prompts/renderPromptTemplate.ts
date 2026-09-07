/**
 * What a prompt template needs in order to name its subject: seven named
 * fields, and nothing else.
 *
 * Deliberately not an `EpicResource` / `QuestResource` / `FeedbackResource`:
 * this text leaves Lore through the clipboard and lands wherever the reader
 * pastes it, so what goes into it is chosen field by field rather than
 * inherited from whatever the resource happens to carry. A sigil key, a
 * session token or a reporter's email must have no path into it.
 */
export interface AgentPromptSubject {
  /**
   * The project's TITLE, which is what MCP's `project_name` matches.
   *
   * ⚠️ Not the slug. `ProjectTools.resolveProjectId` compares `project_name`
   * against `projects.title` lowercased and never reads `projects.slug`,
   * while `slugify` folds accents and hyphenates every run of
   * non-alphanumerics. A project titled `Kanban v2` has the slug `kanban-v2`,
   * and passing that as `project_name` answers "not found". The prompt that
   * shipped before this only resolved because this project is titled
   * `Alepha`.
   */
  project: string;
  /** The project's URL slug, which is how the URL names it. */
  slug: string;
  /**
   * The per-project number the reader recognises: `epics.number`,
   * `quests.shortId`, `feedback.shortId`.
   */
  number: number;
  /** The global id, which `quest_list`'s `epic:` filter wants. */
  id: number;
  /** The typed reference: `#E31`, `#Q1798`, `#P2087`. */
  reference: string;
  /** The subject's title, unescaped. */
  title: string;
  /** Absolute where there is a window, a path otherwise. */
  url: string;
}

/**
 * The names a template may substitute. An unknown one is left verbatim, so
 * a typo in a customised template shows up in the pasted text rather than
 * silently blanking a line.
 */
const PLACEHOLDERS = new Set<keyof AgentPromptSubject>([
  "project",
  "slug",
  "number",
  "id",
  "reference",
  "title",
  "url",
]);

/**
 * `{{name}}`, with whitespace inside the braces tolerated (`{{ title }}`).
 */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Render one prompt template against its subject.
 *
 * ⚠️ **One pass, and a substituted value is never rescanned.** The naive
 * shape (reduce `String.replaceAll` over the seven fields) expands a
 * placeholder that arrives inside a VALUE: a quest titled
 * `Fix {{url}} handling` would have its title substituted first and then
 * its own text expanded, so the pasted prompt would carry the URL twice
 * and the title wrongly. `String.replace` with a function walks the
 * template once and never revisits what it wrote.
 *
 * An unknown placeholder is returned as it was written, never emptied.
 */
export const renderPromptTemplate = (
  template: string,
  subject: AgentPromptSubject,
): string =>
  template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    if (!PLACEHOLDERS.has(name as keyof AgentPromptSubject)) {
      return match;
    }
    return String(subject[name as keyof AgentPromptSubject]);
  });
