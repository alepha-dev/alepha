import { type Infer, z } from "alepha";

/**
 * What `POST /estates/enrol` answers a machine (#Q3165): the estate's
 * long-lived secret, minted by that call, and the slug it belongs to so the
 * machine can say what it joined without printing a secret.
 */
export const estateEnrolExchangeSchema = z.object({
  secret: z.string(),
  slug: z.string(),
});

export type EstateEnrolExchange = Infer<typeof estateEnrolExchangeSchema>;
