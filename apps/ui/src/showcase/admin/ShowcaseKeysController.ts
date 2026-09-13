import { $inject, z } from "alepha";
import {
  adminApiKeyQuerySchema,
  adminApiKeyResourceSchema,
  apiKeyOptionsResponseSchema,
  createApiKeyBodySchema,
  createApiKeyResponseSchema,
  listApiKeyResponseSchema,
  rotateApiKeyBodySchema,
} from "alepha/api/keys";
import { $action } from "alepha/server";

import { SHOWCASE_KEYS } from "@/web/pages/pages/account/accountFixtures.ts";

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
    handler: ({ query }) => this.keys.paginate(query),
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
        permissions: body.permissions ?? [],
        createdAt: new Date(Date.UTC(2026, 8, 5, 9, 0)).toISOString(),
        expiresAt: undefined,
      }) as any,
  });

  /**
   * The account panel's list: the showcase's own fixture rows.
   */
  public readonly listApiKeys = $action({
    path: "/api-keys",
    schema: { response: listApiKeyResponseSchema },
    handler: () => SHOWCASE_KEYS,
  });

  /**
   * What the create dialog reads: every preset, 90 days preselected, and a
   * small catalogue so the permission matrix has groups to draw.
   */
  public readonly getApiKeyOptions = $action({
    path: "/api-keys/options",
    schema: { response: apiKeyOptionsResponseSchema },
    handler: () =>
      ({
        expiry: {
          default: "90d" as const,
          maxDays: 0,
          presets: ["7d", "30d", "60d", "90d", "180d", "1y", "never"] as const,
        },
        permissions: {
          groups: [
            {
              name: "project",
              permissions: [
                { name: "project:read" },
                { name: "project:update" },
              ],
            },
            {
              name: "quest",
              permissions: [{ name: "quest:read" }, { name: "quest:create" }],
            },
            { name: "api-key", permissions: [{ name: "api-key:create" }] },
          ],
        },
      }) as any,
  });

  public readonly rotateMyApiKey = $action({
    method: "POST",
    path: "/api-keys/:id/rotate",
    schema: {
      params: z.object({ id: z.text() }),
      body: rotateApiKeyBodySchema,
      response: createApiKeyResponseSchema,
    },
    handler: ({ params }) =>
      ({
        id: params.id,
        name: "Rotated key",
        token: "ak_showcase_rotated_not_a_real_credential_0000",
        tokenSuffix: "0000",
        roles: [],
        permissions: [],
        createdAt: new Date(Date.UTC(2026, 8, 5, 9, 0)).toISOString(),
      }) as any,
  });

  public readonly revokeMyApiKey = $action({
    method: "DELETE",
    path: "/api-keys/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
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
