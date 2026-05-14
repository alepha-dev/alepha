import { $inject } from "alepha";
import { AlephaLoreParser } from "./parsers/AlephaLoreParser.ts";
import { TrelloParser } from "./parsers/TrelloParser.ts";

export type QuestImportFormat = "alepha-lore" | "trello";

/**
 * Picks the format-specific parser for an incoming CSV based on the header
 * row. Adding a new format = add a parser, register here, expose via
 * `detect`/`parser`.
 */
export class QuestImportFormatProvider {
  protected readonly alephaLore = $inject(AlephaLoreParser);
  protected readonly trello = $inject(TrelloParser);

  public detect(header: string[]): QuestImportFormat | undefined {
    if (this.alephaLore.canParse(header)) return "alepha-lore";
    if (this.trello.canParse(header)) return "trello";
    return undefined;
  }

  public parser(format: QuestImportFormat): AlephaLoreParser | TrelloParser {
    return format === "alepha-lore" ? this.alephaLore : this.trello;
  }
}
