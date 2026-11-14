import { type Infer, z } from "alepha";

/**
 * What `POST /estates/enrol` answers a machine (#Q3165): the host's
 * long-lived secret, minted by that call, and the slug it belongs to so the
 * machine can say what it joined without printing a secret.
 */
export const hostEnrolExchangeSchema = z.object({
  secret: z.string(),
  slug: z.string(),
});

export type HostEnrolExchange = Infer<typeof hostEnrolExchangeSchema>;
