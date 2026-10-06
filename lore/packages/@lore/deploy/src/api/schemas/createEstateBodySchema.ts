import { type Infer, z } from "alepha";

import {
  cloudflareAccountIdSchema,
  cloudflareTokenSchema,
} from "./cloudflareCredentialSchema.ts";
import { estateSlugSchema } from "./estateSlugSchema.ts";

/**
 * What creating an estate takes, by type.
 *
 * Two entry points share it, `EstateController.createEstate` and
 * `ProjectEstateController.createProjectEstate`, so the account page and the
 * create-and-lend path cannot disagree about what a type requires.
 *
 * ⚠️ **An omitted `type` still means `bay`**, which is what keeps the
 * existing e2e (`estates.spec.ts` fills the slug and submits, nothing else)
 * and the Bay install guide working.
 *
 * ⚠️ **The token is part of creation, never a second step** (owner's ruling,
 * 2026-09-06): there is no cloudflare branch without one, so no endpoint can
 * create a cloudflare estate whose credential is checked later. The row is
 * written only after #1630's checks pass.
 */
export const createEstateBodySchema = z.union([
  z.object({
    type: z.literal("bay").optional(),
    slug: estateSlugSchema,
    label: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal("cloudflare"),
    slug: estateSlugSchema,
    label: z.string().max(100).optional(),
    accountId: cloudflareAccountIdSchema,
    token: cloudflareTokenSchema,
  }),
]);

export type CreateEstateBody = Infer<typeof createEstateBodySchema>;
