/**
 * How a persona's Alepha role reads on its card and its page (#Q3960).
 *
 * The role is free text (`personas.alephaRole`, 120 characters): most are a
 * `$role` or service account identifier, `control_room` or `shop-manager`,
 * and some are a sentence describing several roles at once. An identifier
 * reads as a badge, humanized: `control_room` becomes "Control room". A
 * sentence stays plain text, as written, rather than a badge wrapping across
 * the card's header or a code chip nobody reads as prose.
 */
export type AlephaRoleLabel =
  | { kind: "badge"; label: string }
  | { kind: "text"; text: string };

/**
 * One word or one identifier: letters, digits, `_`, `-`, `.` and `:`, no
 * space. Longer than this it is a sentence, whatever it holds.
 */
const IDENTIFIER = /^[\p{L}\p{N}_.:-]+$/u;
const MAX_BADGE = 32;

export const alephaRoleLabel = (role: string): AlephaRoleLabel => {
  const trimmed = role.trim();
  if (trimmed.length > MAX_BADGE || !IDENTIFIER.test(trimmed)) {
    return { kind: "text", text: trimmed };
  }
  const words = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_.:-]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    kind: "badge",
    label: words.charAt(0).toUpperCase() + words.slice(1),
  };
};
