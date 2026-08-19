import { type Infer, z } from "alepha";

/**
 * The three things in a project that carry a title, a rich-text body, and
 * therefore wiki-links: a **folio**, a **quest**, an **epic**.
 *
 * "Element" is deliberately a CODE-level abstraction and nothing more.
 * There is no `elements` table, no `element_*` MCP tool and no `/elements`
 * route, and there should not be: Lore has been renamed twice, and the
 * second rename took production down on every project read because a
 * required JSON key changed name. A fourth top-level noun reaching the
 * database and the MCP surface would be that class of change again, and it
 * buys nothing — the union only has to exist where link handling and the
 * editor are generic. A quest stays a quest everywhere else.
 *
 * Distinct from {@link linkTargetKindSchema}, which is this plus `blob`: a
 * blob can be POINTED AT but has no body, so it is a link target and never
 * a link source.
 *
 * ⚠️ **This is NOT the set of things that can CONTAIN a link.** A comment
 * will carry `[[...]]` too once comments land, and a comment is not an
 * element — it has no title, and it hangs off an element rather than being
 * one. So when `folio_links.from_id` becomes polymorphic, its discriminator
 * must be its own enum (`linkSourceKind`: folio | quest | epic | comment),
 * NOT this one. Reusing `elementKind` there would either bar comments from
 * linking or force "comment" into a union that means something else — and
 * unpicking that later is a stored-value migration, because the literals
 * are what sits in the column.
 */
export const elementKindSchema = z.enum(["folio", "quest", "epic"]);

export type ElementKind = Infer<typeof elementKindSchema>;
