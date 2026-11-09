import type { AiPageContext } from "alepha/ai";

/**
 * Reads what Lore's web puts in a turn's page context (#Q3208).
 *
 * `ProjectView` pushes `{ projectId, projectSlug, projectTitle, language,
 * contentLanguage }` through `useAiContext`; off a project page there is no
 * such entry. The context is client-supplied: it decides what the model is
 * shown, never what a tool may do, since every tool runs its own gate.
 */
export class LoreAiContext {
  /**
   * The project the turn was sent from, or `undefined` off a project page.
   */
  public projectIdOf(context: AiPageContext | undefined): number | undefined {
    const id = this.dataOf(context).projectId;
    return typeof id === "number" && Number.isInteger(id) && id > 0
      ? id
      : undefined;
  }

  protected dataOf(
    context: AiPageContext | undefined,
  ): Record<string, unknown> {
    const data = context?.data;
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  }
}
