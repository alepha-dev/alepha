// Relative rather than `@/`: the api tree imports this module too, and a
// workspace that compiles a Lore api file from outside the app (the sigil
// package's typecheck does) has no `@/` alias to resolve it with.
import type { LinkTargetKind } from "../../../../../api/schemas/linkTargetKindSchema.ts";

/**
 * The typed reference grammar: `#<LETTER><integer>`, project-scoped.
 *
 * One letter names the kind and the integer is that kind's per-project
 * number, so the same string is what a reader sees on a screen and what an
 * author types into a body: `#Q12` is quest 12, `#E3` is epic 3, `#F12` is
 * folio 12. Inside `[[ ]]` it is the wiki-link token; bare, it is how every
 * surface labels the thing (epic #32).
 *
 * Both link parsers read the grammar through this one module: on the server
 * `FolioLinkService.parseToken`, which persists `folio_links`, and in the
 * browser `folioWikiLinkResolver`, which renders. A letter added here is
 * known to both at once, which is the only way the graph and the page can
 * keep agreeing on what a token means.
 *
 * Letters match case-insensitively on the way in (`#q12` works) and are
 * emitted uppercase, always.
 */
export type ReferenceKind = Extract<
  LinkTargetKind,
  "quest" | "epic" | "folio" | "feedback" | "release"
>;

/**
 * The letter each kind is addressed by. `F` is the folio, which is why
 * feedback keeps `P`, the letter it had as Petitions before the 2026-08
 * rename: the stored kind is `feedback`, only the letter is legacy.
 */
export const REFERENCE_LETTERS: Record<ReferenceKind, string> = {
  quest: "Q",
  epic: "E",
  folio: "F",
  feedback: "P",
  release: "R",
};

/**
 * Whether a link kind has a letter, which a `blob` and a `comment` do not.
 * The Links tab renders every kind through one row shape and asks this
 * before labelling one.
 */
export const isReferenceKind = (kind: string): kind is ReferenceKind =>
  Object.hasOwn(REFERENCE_LETTERS, kind);

export interface TypedReference {
  kind: ReferenceKind;
  /**
   * The per-project number: `quests.shortId`, `epics.number`,
   * `folios.shortId`, `feedback.shortId`, `releases.number`. A release's
   * tag is a display label and never an address.
   */
  id: number;
}

/**
 * One letter, then digits, and nothing else. A trailing `#anchor` or a
 * title after the number is not the grammar and reads as no reference.
 */
const TYPED_REFERENCE = /^#([A-Za-z])(\d+)$/;

/**
 * Parse the inner text of a token, `#Q12`, into its kind and number.
 * Returns `undefined` for anything that is not the grammar, including a
 * letter no kind claims, so a caller can fall through to whatever else it
 * accepts.
 */
export const parseTypedReference = (
  body: string,
): TypedReference | undefined => {
  const match = TYPED_REFERENCE.exec(body.trim());
  if (!match) return undefined;
  const letter = match[1].toUpperCase();
  const kind = (Object.keys(REFERENCE_LETTERS) as ReferenceKind[]).find(
    (candidate) => REFERENCE_LETTERS[candidate] === letter,
  );
  if (!kind) return undefined;
  return { kind, id: Number.parseInt(match[2], 10) };
};

/**
 * The string a reference is shown and typed as: `formatReference("quest", 12)`
 * is `#Q12`. Every surface that labels a quest, an epic or a folio by number
 * goes through here, so the next kind is one entry in `REFERENCE_LETTERS`
 * rather than another audit of the screens.
 */
export const formatReference = (kind: ReferenceKind, id: number): string =>
  `#${REFERENCE_LETTERS[kind]}${id}`;
