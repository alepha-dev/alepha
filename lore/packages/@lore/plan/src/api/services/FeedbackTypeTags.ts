import type { FeedbackType } from "../schemas/feedbackTypeSchema.ts";

/**
 * A feedback report's type as one of its tags (#Q4037), the convention the
 * embed launcher's `?type=bug|feature` started: bare tags, `bug`, `feature`
 * (an Idea), `question` and `other`. Shared by the request form and
 * `feedback_submit`, so every path tags alike. Pure, no dependency: the
 * browser loads it.
 */
export class FeedbackTypeTags {
  /**
   * The tag cap `feedbackBodySchema` enforces; the type counts.
   */
  public static readonly MAX_TAGS = 20;

  protected static readonly TAG_OF: Record<FeedbackType, string> = {
    bug: "bug",
    idea: "feature",
    question: "question",
    other: "other",
  };

  public static tagOf(type: FeedbackType): string {
    return FeedbackTypeTags.TAG_OF[type];
  }

  /**
   * The type a tag list already says, the first type tag in it: what a
   * `?type=` in the URL preselects.
   */
  public static typeOf(tags: readonly string[]): FeedbackType | undefined {
    for (const tag of tags) {
      const found = (
        Object.entries(FeedbackTypeTags.TAG_OF) as [FeedbackType, string][]
      ).find(([, value]) => value === tag);
      if (found) return found[0];
    }
    return undefined;
  }

  /**
   * `tags` with the type's tag first and no other type tag, never twice,
   * capped at {@link MAX_TAGS}.
   */
  public static fold(tags: readonly string[], type: FeedbackType): string[] {
    const typeTags = Object.values(FeedbackTypeTags.TAG_OF);
    const rest = tags.filter((tag) => !typeTags.includes(tag));
    return [FeedbackTypeTags.tagOf(type), ...rest].slice(
      0,
      FeedbackTypeTags.MAX_TAGS,
    );
  }
}
