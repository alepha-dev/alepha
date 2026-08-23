import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { linkSourceKindSchema } from "../schemas/linkSourceKindSchema.ts";
import { linkTargetKindSchema } from "../schemas/linkTargetKindSchema.ts";
/**
 * Outbound wiki-style `[[...]]` links between elements. `fromType` +
 * `fromId` identify what contains the reference; `targetType` + `toId`
 * what it resolved to. One row per reference.
 *
 * **The name lies, on purpose.** It holds quest→epic rows now, not just
 * folio→folio. Renaming a table whose name is only ever read by humans
 * costs a migration on the one database that has rows, and this repo has
 * been bitten by exactly that class of change twice — same verdict as the
 * `archive-blobs` bucket, which also still says "archive".
 *
 * The table is **derived data** — re-synced from scratch whenever an
 * element is saved. That is what makes losing it survivable: a wipe
 * regenerates on the next edit of each source.
 *
 * NEITHER side is a foreign key now. `toId` never was (targets span four
 * tables); `fromId` stopped being one when sources did. The consequence
 * worth remembering is on `fromId` below.
 *
 * NOTE on D1: this table is a **leaf** — nothing references it — so a
 * rebuild of it drops nothing else. It is the rare safe rebuild in this
 * schema, which is what made the polymorphic migration cheap.
 */
export const folioLinks = $entity({
  name: "folio_links",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    /**
     * Discriminator for the SOURCE table. Defaults to `folio` so every row
     * written before links became polymorphic stays valid without a
     * backfill beyond the migration's own literal.
     *
     * Its own enum, NOT `elementKind` — see {@link linkSourceKindSchema}.
     */
    fromType: db.default(linkSourceKindSchema.meta({ mode: "text" }), "folio"),
    /**
     * Resolved source id, stringified like {@link toId}: a folio's UUID, a
     * quest's or epic's integer. **No foreign key**, and that is the whole
     * point — one column has to hold ids from four tables.
     *
     * ⚠️ Dropping the FK dropped its `ON DELETE CASCADE` with it, which is
     * what used to clear a folio's outbound links when the folio was hard
     * deleted. `FolioLinkService.deleteLinksFrom` replaces it and the
     * delete handlers must call it — nothing in the schema will complain
     * if they stop.
     */
    fromId: z.string(),
    /**
     * Resolved target id. For `folio` targets this is a `folios.id` UUID;
     * for `quest` targets it's a stringified `quests.id` integer (we don't
     * FK at the row level — quests live in another table with an integer
     * key and we want a single column shape across types). Caller resolves
     * via the appropriate repository keyed on `targetType`.
     */
    toId: z.string(),
    /**
     * Discriminator for the target table. Defaults to `folio` so pre-Lore
     * #57 rows stay valid without a backfill. Add new types by extending
     * {@link linkTargetKindSchema} + teaching `FolioLinkService` to
     * resolve them — which is all `epic` needed.
     *
     * `mode: "text"` ⇒ no CHECK constraint at the DB level — extending
     * the enum is a code-only change, no migration needed.
     */
    targetType: db.default(
      linkTargetKindSchema.meta({ mode: "text" }),
      "folio",
    ),
  }),
  indexes: [
    /**
     * Look up outbound links from one source. Also enforces no-duplicates.
     *
     * `fromType` is part of the key and is load-bearing: ids are
     * stringified per table, so quest 5 and epic 5 are BOTH `"5"`. Without
     * the discriminator they would collide on this unique index and the
     * second one to sync would fail.
     */
    { columns: ["fromType", "fromId", "toId"], unique: true },
    /**
     * Look up backlinks — every folio that points TO this one.
     */
    { columns: ["toId"] },
  ],
});

export type FolioLink = Infer<typeof folioLinks.schema>;
