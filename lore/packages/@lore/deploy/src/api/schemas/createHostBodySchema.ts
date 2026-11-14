import { type Infer, z } from "alepha";

import {
  cloudflareAccountIdSchema,
  cloudflareTokenSchema,
} from "./cloudflareCredentialSchema.ts";
import { hostSlugSchema } from "./hostSlugSchema.ts";

/**
 * What creating a host takes, by type.
 *
 * Two entry points share it, `HostController.createHost` and
 * `ProjectHostController.createProjectHost`, so the account page and the
 * create-and-lend path cannot disagree about what a type requires.
 *
 * ⚠️ **An omitted `type` still means `bay`**, which is what keeps the
 * existing e2e (`hosts.spec.ts` fills the slug and submits, nothing else)
 * and the Bay install guide working.
 *
 * ⚠️ **The token is part of creation, never a second step** (owner's ruling,
 * 2026-09-06): there is no cloudflare branch without one, so no endpoint can
 * create a cloudflare host whose credential is checked later. The row is
 * written only after #1630's checks pass.
 */
export const createHostBodySchema = z.union([
  z.object({
    type: z.literal("bay").optional(),
    slug: hostSlugSchema,
    label: z.string().max(100).optional(),
  }),
  z.object({
    type: z.literal("cloudflare"),
    slug: hostSlugSchema,
    label: z.string().max(100).optional(),
    accountId: cloudflareAccountIdSchema,
    token: cloudflareTokenSchema,
  }),
]);

export type CreateHostBody = Infer<typeof createHostBodySchema>;
