import { $inject, z } from "alepha";
import {
  adminApiKeyQuerySchema,
  adminApiKeyResourceSchema,
  createApiKeyBodySchema,
  createApiKeyResponseSchema,
} from "alepha/api/keys";
import { $action } from "alepha/server";

import { ShowcaseKeys } from "./ShowcaseKeys.ts";

/**
 * Stands in for BOTH `AdminApiKeyController` and `ApiKeyController`.
 *
 * `AdminKeys` holds two clients: the admin one for the listing and revocation,
 * and the user-facing one for creation, because minting a key is an act of the
 * signed-in user rather than an administrative edit. Both halves are declared
 * here since a single container has one flat action namespace.
 *
 * ⚠️ `createApiKey` is the one fixture that returns something the real API
 * shows exactly once: the full token. The value is obviously fake so nobody
 * mistakes what is on screen for a credential, but the SHAPE is real, which is
 * what makes the reveal dialog render the way it does in a live app.
 */
export class ShowcaseKeysController {
  protected readonly keys = $inject(ShowcaseKeys);

  public readonly findApiKeys = $action({
    path: "/admin/api-keys",
    schema: {
      query: adminApiKeyQuerySchema,
      response: z.page(adminApiKeyResourceSchema),
    },
    handler: ({ query }) => this.keys.paginate(query as any),
  });

  public readonly createApiKey = $action({
    method: "POST",
    path: "/api-keys",
    schema: {
      body: createApiKeyBodySchema,
      response: createApiKeyResponseSchema,
    },
    handler: ({ body }) =>
      ({
        id: "00000000-0000-4000-b000-000000000099",
        name: body.name,
        token: "ak_showcase_this_is_not_a_real_credential_0000",
        tokenSuffix: "0000",
        roles: [],
        createdAt: new Date(Date.UTC(2026, 8, 5, 9, 0)).toISOString(),
        expiresAt: undefined,
      }) as any,
  });

  public readonly revokeApiKey = $action({
    method: "DELETE",
    path: "/admin/api-keys/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly revokeApiKeys = $action({
    method: "DELETE",
    path: "/admin/api-keys",
    schema: {
      body: z.object({ ids: z.array(z.text()) }),
      response: z.object({ revoked: z.integer() }),
    },
    handler: ({ body }) => ({ revoked: body.ids.length }),
  });
}
