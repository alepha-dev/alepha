import { useI18n } from "alepha/react/i18n";

import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationOutlineBlock } from "../../../../../../api/schemas/AutomationOutline.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";

/**
 * The automation in plain words (#Q3849): one sentence per block, "When a
 * deploy fails, only if env equals production: create a quest, then tag
 * the quest; send a notification. Otherwise: append to a folio."
 */
export const useAutomationOutlineWords = () => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const text = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value ?? "");
  const lower = (words: string) =>
    words ? words[0].toLowerCase() + words.slice(1) : words;
  const action = (node: AutomationGraphNode) =>
    lower(tr(`automation.action.${node.type}`, { default: node.type }));
  const side = (sequences: AutomationGraphNode[][]) =>
    sequences.length
      ? sequences
          .map((sequence) =>
            sequence.map(action).join(tr("automation.outline.words.then")),
          )
          .join(tr("automation.outline.words.and"))
      : tr("automation.outline.words.nothing");
  return (blocks: AutomationOutlineBlock[]) =>
    blocks.map((block) => {
      const events = block.events
        .map((node) => lower(labels.source(node)))
        .join(tr("automation.outline.or"));
      const config = (block.condition?.config ?? {}) as {
        field?: unknown;
        operator?: unknown;
        value?: unknown;
      };
      const operator = text(config.operator);
      const condition = block.condition
        ? tr("automation.outline.words.onlyIf", {
            args: [
              text(config.field) || "...",
              tr(`automation.operator.${operator}`, { default: operator }),
              config.value === undefined || config.value === ""
                ? "..."
                : text(config.value),
            ],
          })
        : "";
      const sentence = tr("automation.outline.words.block", {
        args: [events, condition, side(block.sequences)],
      });
      return block.condition
        ? `${sentence} ${tr("automation.outline.words.otherwise", {
            args: [side(block.otherwise)],
          })}`
        : sentence;
    });
};
