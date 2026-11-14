import { z } from "alepha";

import { HOST_SLUG_MAX_LENGTH } from "../../../../api/schemas/hostSlugSchema.ts";

/**
 * The create-host form, as `useForm` needs to see it.
 *
 * ⚠️ **It is not the request body and must not become it.**
 * `hostDraftBody` builds that, as a discriminated union where a `bay`
 * host carries no `accountId` and no `token` at all. A form cannot hold a
 * discriminated union while somebody is filling it in: the two Cloudflare
 * fields have to exist as soon as that segment is picked, and they have to
 * survive switching back and forth. So this is flat, both are optional, and
 * `hostDraftValid` is what decides whether the pair is complete - the same
 * function that decided it before there was a form here at all.
 *
 * The maximum matches the column, so the field stops accepting characters
 * the server would refuse rather than refusing them after a round trip.
 */
export const hostCreateFormSchema = z.object({
  type: z.enum(["bay", "cloudflare"]),
  slug: z.text({ maxLength: HOST_SLUG_MAX_LENGTH }),
  accountId: z.text({ maxLength: 64 }).optional(),
  token: z.text({ maxLength: 128 }).optional(),
});
