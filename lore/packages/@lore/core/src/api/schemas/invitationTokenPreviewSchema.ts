import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * What an unauthenticated visitor holding an invite link is told about it.
 *
 * Deliberately more talkative than `InvitationTokenService.resolve`, which
 * answers a registration attempt and so refuses everything the same way. This
 * answers the page the recipient landed on, where "withdrawn" and "not valid"
 * are different things a person has to be told apart. Every status past
 * `invalid` requires the invitation's own uuid, so a caller with a made-up
 * token learns nothing.
 *
 * `accountExists` is the common case and the reason this endpoint exists at
 * all: with `verifyEmailRequired`, submitting the register form for an
 * address already on file mints a DECOY intent and answers "check your
 * inbox", where no code will ever arrive. The page has to know before it
 * renders a form, not after.
 */
export const invitationTokenPreviewSchema = z.object({
  status: z.enum([
    "ok",
    "accountExists",
    "invalid",
    "expired",
    "accepted",
    "declined",
    "revoked",
  ]),
  /**
   * The invited address. Present whenever the token resolved, so the register
   * form can pre-fill and lock the field it is bound to.
   */
  email: z.email().optional(),
  /**
   * What they were invited to, for the copy. Absent when the project is gone.
   */
  projectTitle: z.text().optional(),
});

export type InvitationTokenPreview = Infer<typeof invitationTokenPreviewSchema>;
