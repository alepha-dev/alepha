import { z } from "alepha";
import { BadRequestError } from "alepha/server";

/**
 * A Cloudflare credential the account check refused. `field` names the input
 * the dialog puts the message beside, rather than in a toast that is gone
 * before it has been read (#1865).
 */
export const EstateCredentialRefused = BadRequestError.extend({
  name: "ESTATE_CREDENTIAL_REFUSED",
  schema: z.object({ field: z.text() }),
  message: "The credential was refused",
});

export type EstateCredentialRefused = InstanceType<
  typeof EstateCredentialRefused
>;
