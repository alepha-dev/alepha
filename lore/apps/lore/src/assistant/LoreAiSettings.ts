import { AiSettings } from "alepha/api/ai";
import { $parameter } from "alepha/api/parameters";

/**
 * The `api.ai` parameter with Lore's defaults (#Q3207, owner 2026-11-08):
 * 200,000 tokens per user over 24 hours, 20 turns a minute, and 30 days of
 * retention, since `ai_messages` stores tool results, folio bodies included.
 *
 * The same parameter, name and schema as the framework's, so an operator
 * still edits it at runtime; only the compiled default differs. The
 * provider keys parameters by name, so this declaration replaces the one
 * the base class registered.
 */
export class LoreAiSettings extends AiSettings {
  public override readonly parameter = $parameter({
    name: "api.ai",
    description: "AI assistant budget, rate and retention settings.",
    schema: this.schemaOf(),
    default: {
      budgetTokens: 200_000,
      budgetWindowHours: 24,
      turnsPerMinute: 20,
      retentionDays: 30,
    },
  });

  /**
   * The framework's schema, read off the parameter the base class declared,
   * so the two can never disagree.
   */
  protected schemaOf() {
    return (this as unknown as AiSettings).parameter.schema;
  }
}
