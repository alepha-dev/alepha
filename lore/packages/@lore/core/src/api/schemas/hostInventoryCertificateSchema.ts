import { type Infer, z } from "alepha";

/**
 * One TLS certificate of a domain a Bay serves, read from its own store
 * (#Q4441): Bay obtains and renews it (ACME), so it knows the expiry without
 * probing anything, and the certificate tile lists it on a Lore that cannot
 * open a socket (Workers).
 */
export const hostInventoryCertificateSchema = z.object({
  domain: z.string().max(253),
  /**
   * When the certificate expires, RFC 3339.
   */
  notAfter: z.string().max(40),
  /**
   * The CA that issued it, by its common name (`R11`, `E6`).
   */
  issuer: z.string().max(200).optional(),
});

export type HostInventoryCertificate = Infer<
  typeof hostInventoryCertificateSchema
>;
