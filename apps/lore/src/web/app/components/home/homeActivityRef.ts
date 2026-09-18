import type { HomeActivityRow } from "@/api/schemas/homeActivityRowSchema.ts";

/**
 * The compact reference a line of the activity panel names its resource by:
 * `#Q2358`, `#E30`, `#F96`.
 *
 * The panel is a 320px column, so it cannot afford "Quest 2358 Make the
 * switcher agree with Home" the way the project's Activity table can. The
 * short form is also what Lore itself uses everywhere else a quest is
 * referred to in passing: commit messages, MCP, the quest's own header.
 *
 * ⚠️ `resourceId` is the identifier each kind is ADDRESSED by - a quest's
 * `shortId`, an epic's `number`, a release's `tag` - decided at the write
 * site. A row with none has nothing to name, and returns `undefined` so the
 * line renders the actor and the verb alone.
 *
 * An unknown kind keeps its id with no letter rather than guessing one: a new
 * `$audit` type reaches this panel the moment it is declared, and a wrong
 * letter is worse than none.
 *
 * A UUID returns `undefined` too, and the line names the resource by its
 * title instead (an estate is `ovh-1`, not `#01a0719b-...`): a UUID is a row
 * id nobody reads, types or recognises, and it filled the line on its own.
 */
export const homeActivityRef = (
  row: Pick<HomeActivityRow, "type" | "resourceId">,
): string | undefined => {
  if (!row.resourceId || UUID.test(row.resourceId)) {
    return undefined;
  }
  const letter = HOME_ACTIVITY_LETTERS[row.type];
  return letter ? `#${letter}${row.resourceId}` : `#${row.resourceId}`;
};

/**
 * One letter per resource kind, matching how Lore writes them elsewhere.
 */
const HOME_ACTIVITY_LETTERS: Record<string, string> = {
  quest: "Q",
  epic: "E",
  release: "R",
  folio: "F",
  feedback: "P",
  blight: "B",
};

/**
 * Any RFC 4122 shape, whatever its version: estates carry v7 ids.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
