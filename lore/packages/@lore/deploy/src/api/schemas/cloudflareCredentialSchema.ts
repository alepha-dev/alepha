import { z } from "alepha";

/**
 * What a Cloudflare account id looks like: 32 lowercase hex characters.
 *
 * Strict on the way in and loose on the column (`max(64)`, #1631), for the
 * reason `estateSlugSchema` gives: a constraint tightened on a column makes
 * a pre-existing row fail to decode, and a row that fails its schema throws
 * every query that touches the table.
 *
 * ⚠️ This is the account the token is checked against, and the only one Lore
 * ever names. Nothing reads `CLOUDFLARE_ACCOUNT_ID`, which on Lore's own
 * Worker is Lore's account rather than the estate owner's (#1629).
 */
export const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const cloudflareAccountIdSchema = z
  .string()
  .regex(CLOUDFLARE_ACCOUNT_ID_PATTERN);

/**
 * The three token shapes Cloudflare issues, accepted as one bound.
 *
 * `cfut_` is a user token and `cfat_` an account-owned one, each the marker
 * plus 40 alphanumerics plus an 8-hex checksum, so 53 characters; a legacy
 * token is 40 characters with no marker at all. The bound accepts all three
 * rather than pinning a format, because Cloudflare has changed it once
 * already and a pattern here would refuse a valid token before any probe
 * could say otherwise. #1630 tells the kinds apart, by their marker, to pick
 * the verify endpoint.
 *
 * ⚠️ Never widen this into something a rejection message could echo. A
 * `min`/`max` failure carries no input value in its zod issue, which is what
 * keeps a pasted token out of a 400 body and out of every log line.
 */
export const cloudflareTokenSchema = z.string().min(40).max(128);
