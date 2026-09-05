import { z } from "alepha";

/**
 * The longest an estate slug may be.
 *
 * Shorter than the column's own `max(64)` would allow if it ever grew, for
 * the reason `appNameSchema` gives: a constraint tightened on the column
 * makes a pre-existing row fail to decode, and a row that fails its schema
 * throws every query that touches the table. The constraint lives on the
 * way in.
 */
export const ESTATE_SLUG_MAX_LENGTH = 64;

/**
 * What an estate slug may contain.
 *
 * The slug is what a person types into `bay connector show`'s output and what
 * a project page shows beside the owner's name, so it has to survive a path,
 * a shell and a table cell without escaping: lowercase letters, digits and
 * interior hyphens. Callers trim and lowercase before testing, so `OVH-1` is
 * accepted as input and stored as `ovh-1` rather than refused.
 */
export const ESTATE_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * The length bound alone, for request bodies.
 *
 * The pattern is not folded in on purpose: a schema rejection happens before
 * the handler runs, which would refuse `OVH-1` outright instead of
 * normalising it. `EstateService.normalizeSlug` tests the pattern itself.
 */
export const estateSlugSchema = z.string().min(1).max(ESTATE_SLUG_MAX_LENGTH);
