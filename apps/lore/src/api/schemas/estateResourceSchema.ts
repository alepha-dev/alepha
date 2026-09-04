import { type Infer, z } from "alepha";

import { estates } from "../entities/estates.ts";

/**
 * An estate as its owner's account page sees it.
 *
 * The entity minus the one field nothing outside the server may read,
 * `secretHash`, plus two facts derived at read time: `online`, from the
 * liveness stamps (see `EstateService.isOnline`), and `acceptedRuntimes`,
 * from the type, which is what epic #1's runtime gate (#1598) reads.
 *
 * ⚠️ There is no read path that returns the secret, for the owner included.
 * `secretPrefix` stays so the UI can name a credential it can never rebuild.
 * One read path that returned plaintext would be one a later permission bug
 * could widen; the admin backstop (#1838) reads the same shape.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too, and importing it from `EstateController.ts` would pull the repository
 * and the database provider into the client bundle.
 */
export const estateResourceSchema = estates.schema
  .omit({ secretHash: true })
  .extend({
    online: z.boolean(),
    acceptedRuntimes: z.array(z.string()),
  });

export type EstateResource = Infer<typeof estateResourceSchema>;

/**
 * An estate plus the one cleartext copy of its secret that will ever exist.
 *
 * Returned by `createEstate` and `rotateEstate` only. The column stores a
 * hash, so a caller that drops this response has to rotate.
 */
export const mintedEstateSchema = estateResourceSchema.extend({
  secret: z.string(),
});

export type MintedEstate = Infer<typeof mintedEstateSchema>;
