import {
  AutomationCollections,
  type AutomationCollectionFormatInput,
} from "@lore/core/api";
import { $inject } from "alepha";
import { BadRequestError } from "alepha/server";

/**
 * Quest summaries are a registered formatter, never a user-authored loop.
 */
export class WorkAutomationCollections {
  protected readonly collections = $inject(AutomationCollections);
  constructor() {
    this.collections.register("quests.tagged", (input) => this.quests(input));
  }
  protected quests(input: AutomationCollectionFormatInput): string {
    const total = input.totalIsExact
      ? String(input.total)
      : `At least ${input.total}`;
    const tag =
      typeof input.values.tag === "string"
        ? ` tagged "${input.values.tag}"`
        : "";
    const header = `${total} matching quests${tag}; ${input.shown} of ${input.selected} selected quests shown.`;
    const items = [...input.items]
      .sort((left, right) => Number(left.shortId) - Number(right.shortId))
      .slice(0, input.shown);
    return [
      header,
      ...items.map((item) => {
        if (
          typeof item.shortId !== "number" ||
          !Number.isSafeInteger(item.shortId) ||
          item.shortId < 1 ||
          typeof item.title !== "string"
        )
          throw new BadRequestError(
            "Quest collection items require a stable shortId and title",
          );
        const title = item.title.replace(/[\r\n\u2028\u2029]+/g, " ");
        return `Quest ${item.shortId}: ${title}${typeof item.url === "string" ? `\n  ${item.url}` : ""}`;
      }),
    ].join("\n");
  }
}
