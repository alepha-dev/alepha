import { formatReference } from "@lore/core/web";

/**
 * What a `feedback.created` automation reads beyond the title, built once for
 * the live event and for a test run on an existing report (#Q3541): the
 * reference (`#P94`), the description cut for a notification, and the report
 * itself rather than the inbox (`?feedback=` opens it).
 */
export class FeedbackAutomationFields {
  /**
   * The description keeps its line breaks, since a report is often a list of
   * steps, and stops at 1,000 characters.
   */
  public build(path: string, row: { shortId: number; description: string }) {
    const text = row.description.replace(/\n{3,}/g, "\n\n").trim();
    return {
      reference: formatReference("feedback", row.shortId),
      description: text.length > 1000 ? `${text.slice(0, 999)}…` : text,
      url: `${path}/feedback?feedback=${row.shortId}`,
    };
  }
}
