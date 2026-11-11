import { $inject, z } from "alepha";
import {
  $secure,
  authenticationOptionsJsonSchema,
  registrationOptionsJsonSchema,
  registrationResponseJsonSchema,
  WebAuthnError,
} from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import {
  LastSignInMethodError,
  PasskeyAssertionProofError,
  PasskeyChallengeError,
  PasskeyConflictError,
  PasskeyLimitError,
  PasskeyPasswordProofError,
  PasskeysDisabledError,
} from "../errors/PasskeyError.ts";
import { myPasskeyListSchema } from "../schemas/myPasskeyListSchema.ts";
import { myPasskeySchema } from "../schemas/myPasskeySchema.ts";
import { passkeyProofSchema } from "../schemas/passkeyProofSchema.ts";
import { PasskeyService } from "../services/PasskeyService.ts";

/**
 * Self-service passkeys: add one, list them, rename one, remove one.
 * Signing in with a passkey is not here: it is a route of
 * `alepha/server/auth`, beside the password login.
 *
 * Scoped to the caller throughout, which is what lets these carry no
 * permission. Adding and removing ask for proof by what the account holds
 * (the current password, else a passkey it already has, else nothing), so
 * a borrowed session cannot plant a passkey that outlives a password
 * change. `GET /users/me/passkeys` says which proof in `proof`.
 *
 * Passkeys are not listed or unlinked through `/users/me/identities`:
 * those routes skip the proof, the audit and the email.
 */
export class MyPasskeyController {
  protected readonly passkeys = $inject(PasskeyService);

  getMyPasskeys = $action({
    method: "GET",
    path: "/users/me/passkeys",
    use: [$secure()],
    description: "List the caller's passkeys and the proof a change asks for",
    schema: { response: myPasskeyListSchema },
    handler: async ({ user, url }) => this.passkeys.list(user, url),
  });

  createMyPasskeyOptions = $action({
    method: "POST",
    path: "/users/me/passkeys/options",
    use: [$secure({ sessionOnly: true })],
    description: "Start adding a passkey: the options for the browser",
    errors: [PasskeysDisabledError, PasskeyLimitError],
    schema: { response: registrationOptionsJsonSchema },
    handler: async ({ user, url, cookies }) =>
      this.passkeys.registrationOptions(user, url, cookies),
  });

  createMyPasskey = $action({
    method: "POST",
    path: "/users/me/passkeys",
    use: [$secure({ sessionOnly: true })],
    description: "Add a passkey from the browser's registration response",
    errors: [
      PasskeysDisabledError,
      PasskeyLimitError,
      PasskeyConflictError,
      PasskeyChallengeError,
      PasskeyPasswordProofError,
      PasskeyAssertionProofError,
      WebAuthnError,
    ],
    schema: {
      body: z.object({
        credential: registrationResponseJsonSchema,
        name: z.text({ size: "short" }).optional(),
        proof: passkeyProofSchema.optional(),
      }),
      response: myPasskeySchema,
    },
    handler: async ({ body, user, url, cookies }) => {
      const identity = await this.passkeys.register(user, body, url, cookies);
      const data = this.passkeys.dataOf(identity);
      return {
        id: identity.id,
        name: data.name,
        createdAt: data.createdAt,
        backedUp: data.backedUp,
        usable: true,
      };
    },
  });

  renameMyPasskey = $action({
    method: "PATCH",
    path: "/users/me/passkeys/:id",
    use: [$secure({ sessionOnly: true })],
    description: "Rename one of the caller's passkeys",
    errors: [NotFoundError],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.text({ size: "short" }) }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, body, user }) => {
      await this.passkeys.rename(user, params.id, body.name);
      return { ok: true };
    },
  });

  deleteMyPasskey = $action({
    method: "DELETE",
    path: "/users/me/passkeys/:id",
    use: [$secure({ sessionOnly: true })],
    description: "Remove one of the caller's passkeys",
    errors: [
      NotFoundError,
      LastSignInMethodError,
      PasskeyPasswordProofError,
      PasskeyAssertionProofError,
    ],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ proof: passkeyProofSchema.optional() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, body, user, url, cookies }) => {
      await this.passkeys.remove(user, params.id, body?.proof, url, cookies);
      return { ok: true };
    },
  });

  createMyPasskeyProofOptions = $action({
    method: "POST",
    path: "/users/me/passkeys/proof/options",
    use: [$secure({ sessionOnly: true })],
    description:
      "Start confirming a passkey change with a passkey the account already holds",
    errors: [PasskeyAssertionProofError],
    schema: { response: authenticationOptionsJsonSchema },
    handler: async ({ user, url, cookies }) =>
      this.passkeys.proofOptions(user, url, cookies),
  });
}
