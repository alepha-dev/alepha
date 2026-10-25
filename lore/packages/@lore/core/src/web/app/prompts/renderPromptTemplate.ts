/**
 * What a prompt about a whole SURFACE has to name: the project, and where
 * the surface is. There is no item, so there is no number, id, reference or
 * title - and that is the whole reason this type exists separately.
 *
 * ⚠️ A loop prompt is not an item prompt with four blank fields. Populating
 * them with `0` and `""` would render `#P0` and an empty title into somebody's
 * clipboard, which is a lie rather than a gap; the type says they are absent,
 * and {@link renderPromptTemplate} leaves `{{reference}}` verbatim when it is,
 * so a template that asks for one shows the reader it asked for something the
 * surface cannot give.
 */
export interface AgentPromptProjectSubject {
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
  /** Absolute where there is a window, a path otherwise. */
  url: string;
}

/**
 * What a prompt about ONE item needs: the project fields, plus the four that
 * name the item.
 *
 * Deliberately not an `EpicResource` / `QuestResource` / `FeedbackResource`:
 * this text leaves Lore through the clipboard and lands wherever the reader
 * pastes it, so what goes into it is chosen field by field rather than
 * inherited from whatever the resource happens to carry. A sigil key, a
 * session token or a reporter's email must have no path into it.
 */
export interface AgentPromptItemSubject extends AgentPromptProjectSubject {
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
}

/**
 * Either shape. A template is rendered against whichever its surface has.
 */
export type AgentPromptSubject =
  | AgentPromptProjectSubject
  | AgentPromptItemSubject;

/**
 * The names a template may substitute, per shape.
 *
 * ⚠️ **An allowlist, never "whatever the subject carries".** The obvious
 * shape for two subject types is `Object.hasOwn(subject, name)`, and it is
 * wrong: it substitutes anything a caller smuggled onto the object, so a
 * subject built by spreading a resource "just this once" would put a sigil
 * key or a reporter's email on somebody's clipboard the moment a template
 * named it. The lists below are what the two types declare, and nothing
 * reaches a pasted prompt without being written here first.
 * `renderPromptTemplate.spec.ts` pins exactly this.
 */
const PROJECT_PLACEHOLDERS = new Set<string>(["project", "slug", "url"]);

const ITEM_PLACEHOLDERS = new Set<string>([
  ...PROJECT_PLACEHOLDERS,
  "number",
  "id",
  "reference",
  "title",
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
    // Which list applies is the SHAPE, not the kind: a surface-scoped subject
    // cannot answer `{{reference}}`, and the honest rendering of a question it
    // cannot answer is the question, left visible. Same treatment as a typo,
    // on purpose - both are a placeholder this subject has no value for, and
    // substituting `undefined` for either would be a lie rather than a gap.
    const allowed =
      "reference" in subject ? ITEM_PLACEHOLDERS : PROJECT_PLACEHOLDERS;
    if (!allowed.has(name)) {
      return match;
    }
    return String((subject as unknown as Record<string, unknown>)[name]);
  });
