import { z } from "alepha";

import { ESTATE_SLUG_MAX_LENGTH } from "@/api/schemas/estateSlugSchema.ts";

/**
 * The create-estate form, as `useForm` needs to see it.
 *
 * ⚠️ **It is not the request body and must not become it.**
 * `estateDraftBody` builds that, as a discriminated union where a `bay`
 * estate carries no `accountId` and no `token` at all. A form cannot hold a
 * discriminated union while somebody is filling it in: the two Cloudflare
 * fields have to exist as soon as that segment is picked, and they have to
 * survive switching back and forth. So this is flat, both are optional, and
 * `estateDraftValid` is what decides whether the pair is complete - the same
 * function that decided it before there was a form here at all.
 *
 * The maximum matches the column, so the field stops accepting characters
 * the server would refuse rather than refusing them after a round trip.
 */
export const estateCreateFormSchema = z.object({
  type: z.enum(["bay", "cloudflare"]),
  slug: z.text({ maxLength: ESTATE_SLUG_MAX_LENGTH }),
  accountId: z.text({ maxLength: 64 }).optional(),
  token: z.text({ maxLength: 128 }).optional(),
});
