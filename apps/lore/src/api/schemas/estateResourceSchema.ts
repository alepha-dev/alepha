import { type Infer, z } from "alepha";

import { estates } from "../entities/estates.ts";

/**
 * An estate as its owner's account page sees it.
 *
 * ⚠️ **A `pick` allowlist, never an `omit`.** It used to be the entity minus
 * `secretHash`, which meant the class doc's promise ("no future field added
 * to the row reaches a browser by accident") was true only until somebody
 * added a secret column: #1631's `credential` would have crossed by default,
 * sealed but present. Subtractive is the wrong direction for a read path.
 * Adding a column to `estates` now shows nothing until a line is added here,
 * which is a decision somebody makes rather than one that makes itself.
 *
 * What crosses for a cloudflare estate: `accountId`, `secretPrefix` (the
 * mask, the same column bay uses) and the check fields (#1630). What never
 * crosses: `credential` and `credentialKeyVersion`, for the owner included.
 * One read path that returns plaintext is one a later permission bug can
 * widen.
 *
 * Plus two facts derived at read time: `online`, from the liveness stamps
 * (see `EstateService.isOnline`), and `acceptedRuntimes`, from the type,
 * which is what epic #1's runtime gate (#1598) reads.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too, and importing it from `EstateController.ts` would pull the repository
 * and the database provider into the client bundle.
 */
export const estateResourceSchema = estates.schema
  .pick({
    id: true,
    createdAt: true,
    updatedAt: true,
    ownerUserId: true,
    type: true,
    slug: true,
    label: true,
    // The mask, for both types: enough to name a credential, never enough to
    // rebuild one.
    secretPrefix: true,
    // Cloudflare: the account the token was checked against, and what #1630
    // stored about that check.
    accountId: true,
    credentialCheckedAt: true,
    credentialError: true,
    credentialExpiresAt: true,
    collectSeries: true,
    deployAllowed: true,
    statsIntervalSeconds: true,
    connectedAt: true,
    disconnectedAt: true,
    connectionId: true,
    lastSeenAt: true,
    cpuPercent: true,
    memoryPercent: true,
    statsAt: true,
  })
  .extend({
    online: z.boolean(),
    acceptedRuntimes: z.array(z.string()),
  });

export type EstateResource = Infer<typeof estateResourceSchema>;

/**
 * An estate plus the one cleartext copy of a secret Lore minted, if it
 * minted one.
 *
 * ⚠️ `secret` is **optional, and absent rather than empty** when Lore minted
 * nothing. A bay create and a bay rotate produce a secret shown once; a
 * cloudflare create produces none at all, because the user brought the
 * token. An empty string would have made "the secret dialog does not open"
 * rest on `Boolean("")`, an accident nobody pinned; an absent field makes
 * every caller handle it, and the spec asserts absence.
 *
 * The column stores a hash, so a caller that drops a present `secret` has to
 * rotate.
 */
export const mintedEstateSchema = estateResourceSchema.extend({
  secret: z.string().optional(),
});

export type MintedEstate = Infer<typeof mintedEstateSchema>;
